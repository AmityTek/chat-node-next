require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const redis = require('redis');
const { createShardedAdapter } = require('@socket.io/redis-adapter');

const app = express();
const server = http.createServer(app);
const connectedUsers = {}; 

mongoose.connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
}).then(() => console.log('MongoDB connecté'))
    .catch(err => console.error('Erreur MongoDB:', err));

const MessageSchema = new mongoose.Schema({
    room: { type: String, required: true },
    user: { type: String, required: true },
    message: { type: String, required: true },
    replyTo: { type: mongoose.Schema.Types.ObjectId, ref: "Message", default: null },
    timestamp: { type: Date, default: Date.now },
});
const Message = mongoose.model('Message', MessageSchema);

const pubClient = redis.createClient({ url: process.env.REDIS_URL });

const subClient = pubClient.duplicate();
Promise.all([pubClient.connect(), subClient.connect()])
    .then(() => console.log('Redis connecté'))
    .catch(err => console.error('Erreur Redis:', err));

const io = new Server(server, {
    cors: { origin: '*' },
});
io.adapter(createShardedAdapter(pubClient, subClient));

io.on('connection', (socket) => {
    console.log(`Utilisateur connecté: ${socket.id}`);

    socket.on("joinRoom", async (room) => {
        try {
            socket.join(room);

            connectedUsers[socket.id] = room;

            const messages = await Message.find({ room }).sort({ createdAt: -1 }).limit(50).populate("replyTo");
            console.log("Loaded messages", messages);
            socket.emit("loadMessages", messages);

            const roomSockets = await io.in(room).fetchSockets();
            io.to(room).emit("updateUsers", roomSockets.map(s => s.id));
        } catch (err) {
            console.error("Error on joinRoom:", err);
        }
    });

    socket.on("sendMessage", async ({ room, message, replyTo }) => {
        try {
            console.log("Incoming message:", { room, message, replyTo });  

            let replyToId = null;

            if (replyTo && replyTo._id) {
                const repliedMsg = await Message.findById(replyTo._id);

                console.log("Replied Message:", repliedMsg);
                if (repliedMsg) {
                    replyToId = repliedMsg._id;
                }
            }

            const msg = new Message({ 
                room, 
                user: socket.id, 
                message, 
                replyTo: replyToId,
            });
            
            await msg.save();
            console.log("After MEssage => ", msg);
            const populatedMsg = replyTo
                ? await Message.findById(msg._id).populate("replyTo")
                : msg;

            io.to(room).emit("receiveMessage", populatedMsg);
        } catch (err) {
            console.error("❌ Message Save Error:", err);
        }
    });

    socket.on("editMessage", async ({ messageId, newMessage }) => {
        try {
            const existingMessage = await Message.findById(messageId);
           
            if (!existingMessage) {
                console.error("Message not found");
                return;
            }

            const updatedMsg = await Message.findByIdAndUpdate(
                messageId,
                { message: newMessage ,
                    replyTo: existingMessage.replyTo 
                },
                { new: true }
            );

            if (updatedMsg) {
                io.to(updatedMsg.room).emit("receiveMessage", updatedMsg);
            }
        } catch (err) {
            console.error("Error editing message:", err);
        }
    });

    socket.on("deleteMessage", async ({ messageId }) => {
        try {
            const deletedMsg = await Message.findByIdAndDelete(messageId);

            if (deletedMsg) {
                io.to(deletedMsg.room).emit("messageDeleted", messageId);
            }
        } catch (err) {
            console.error("Error deleting message:", err);
        }
    });

    socket.on("disconnect", async () => {
        try {
            console.log(`🔴 User disconnected: ${socket.id}`);

            const room = connectedUsers[socket.id];
            delete connectedUsers[socket.id];

            const usersInRoom = Object.keys(connectedUsers).filter(id => connectedUsers[id] === room);
            io.to(room).emit("updateUsers", usersInRoom);
        } catch (err) {
            console.error("Error on disconnect:", err);
        }
    });
});

const PORT = process.env.PORT || 3010;
server.listen(PORT, () => console.log(`Serveur WebSocket sur http://localhost:${PORT}`));