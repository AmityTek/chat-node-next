"use client";

import { useEffect, useState, useRef } from "react";
import { io } from "socket.io-client";
import { EditorContent, ReactRenderer, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Mention from "@tiptap/extension-mention";
import axios from "axios";
import Picker from "@emoji-mart/react";
import emojiData from "@emoji-mart/data";
import { useDropzone } from "react-dropzone";
import tippy from "tippy.js";

const socket = io("http://localhost:3010", { transports: ["websocket", "polling"] });

const MentionList = ({ items, command }) => {
    return (
        <div className="bg-gray-700 text-white border border-gray-600 rounded-lg shadow-lg">
            {items.length > 0 ? (
                items.map((user, index) => (
                    <div
                        key={index}
                        onClick={() => command({ id: user })}
                        className="px-4 py-2 hover:bg-gray-600 cursor-pointer"
                    >
                        {user}
                    </div>
                ))
            ) : (
                <div className="px-4 py-2 text-gray-400">No users found</div>
            )}
        </div>
    );
};


export default function Chat() {
    const [room, setRoom] = useState("general");
    const [messages, setMessages] = useState([]);
    const [users, setUsers] = useState([]);
    const [editingMessage, setEditingMessage] = useState(null);
    const [replyingTo, setReplyingTo] = useState(null);
    const [showEmojiPicker, setShowEmojiPicker] = useState(false);
    const [showOptions, setShowOptions] = useState(null);
    const optionsRef = useRef(null)
    const messagesEndRef = useRef(null);

    const editor = useEditor({
        extensions: [
            StarterKit,
            Mention.configure({
                HTMLAttributes: {
                    class: "bg-blue-200 text-blue-800 rounded px-1 py-0.5 mx-1"
                },
                suggestion: {
                    items: ({ query }) => {
                        return users.filter(user =>
                            user.toLowerCase().includes(query.toLowerCase())
                        );
                    },
                    render: () => {
                        let component;
                        let popup;

                        return {
                            onStart: (props) => {
                                component = new ReactRenderer(MentionList, {
                                    props,
                                    editor: props.editor,
                                });

                                popup = tippy('body', {
                                    getReferenceClientRect: props.clientRect,
                                    appendTo: () => document.body,
                                    content: component.element,
                                    showOnCreate: true,
                                    interactive: true,
                                    trigger: 'manual',
                                    placement: 'bottom-start',
                                });
                            },
                            onUpdate: (props) => {
                                component.updateProps(props);
                                popup[0].setProps({
                                    getReferenceClientRect: props.clientRect,
                                });
                            },
                            onKeyDown: (props) => {
                                if (props.event.key === 'Escape') {
                                    popup[0].hide();
                                    return true;
                                }
                                return false;
                            },
                            onExit: () => {
                                popup[0].destroy();
                                component.destroy();
                            },
                        };
                    },
                },
            }),
        ],
        content: "",
        immediatelyRender: false,
    });

    useEffect(() => {
        socket.emit("joinRoom", room);
        socket.on("loadMessages", (loadedMessages) =>  {
            console.log("LoadMesssages => ", loadedMessages);
            setMessages(loadedMessages)
            setTimeout(scrollToBottom, 100); 
    
        });
        socket.on("receiveMessage", (data) => {
            setMessages((prev) => {
                const exists = prev.some(msg => msg._id === data._id);
                if (exists) {
                    return prev.map(msg => msg._id === data._id ? data : msg);
                }
                return [...prev, data];
            });
            setTimeout(scrollToBottom, 100);
        });

        socket.on("updateUsers", (connectedUsers) => setUsers(connectedUsers || []));

        socket.on("messageDeleted", (messageId) => {
            setMessages((prev) => prev.filter(msg => msg._id !== messageId));
        });

        return () => {
            socket.off("receiveMessage");
            socket.off("updateUsers");
            socket.off("messageDeleted");
        };
    }, [room]);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };


    const sendMessage = () => {
        const message = editor?.getText().trim();
        if (!message)
            return;

        if (editingMessage) {
            socket.emit("editMessage", {
                messageId: editingMessage,
                newMessage: message
            }, (updatedMessage) => {
                setMessages(prevMessages =>
                    prevMessages.map(msg =>
                        msg._id === editingMessage
                            ? {
                                ...updatedMessage,
                                replyTo: updatedMessage.replyTo || msg.replyTo
                            }
                            : msg
                    )
                );
                // Reset editing state
                setEditingMessage(null);
            });
        } else {
            socket.emit("sendMessage", { room, message, replyTo: replyingTo || null }, (newMessage) => {
                setMessages([...messages, newMessage]);
            });
            setReplyingTo(null);
        }

        editor?.commands.clearContent();
    };

    const replyToMessage = (msg) => {
        setReplyingTo({
            _id: msg._id,
            user: msg.user,
            message: msg.message,
        });
    };

    const editMessage = (messageId) => {
        const messageToEdit = messages.find(msg => msg._id === messageId);
        if (!messageToEdit) 
            return;

        editor?.commands.setContent(messageToEdit.message);
        setEditingMessage(messageId);
    };

    const deleteMessage = (messageId) => {
        socket.emit("deleteMessage", { messageId }, () => {
            setMessages(messages.filter(msg => msg._id !== messageId));
        });
    };

    const addEmoji = (emoji) => {
        editor?.commands.insertContent(emoji.native);
        setShowEmojiPicker(false);
    };

    const handleClickOutside = (event) => {
        if (optionsRef.current && !optionsRef.current.contains(event.target)) {
            setShowOptions(null);
        }
    };

    useEffect(() => {
        document.addEventListener("mousedown", handleClickOutside);
        return () => {
            document.removeEventListener("mousedown", handleClickOutside);
        };
    }, []);

    const { getRootProps, getInputProps } = useDropzone({
        accept: { "image/*": [] },
        multiple: false,
        onDrop: async (acceptedFiles) => {
            const formData = new FormData();
            formData.append("file", acceptedFiles[0]);
            try {
                const { data } = await axios.post("http://localhost:3010/upload", formData);
                socket.emit("sendImage", { room, imageUrl: data.fileUrl });
            } catch (error) {
                console.error("Upload failed", error);
            }
        },
    });

    return (
        <div className="w-[900px] mx-auto bg-gray-900 text-white p-4 mt-5 rounded-lg shadow-lg flex flex-col h-[85vh]">
            <h2 className="text-xl font-bold mb-4">Chat Room: {room}</h2>
            <div className="text-gray-400 mb-2">
                Connected Users: {users.length > 0 ? users.join(", ") : "No users online"}
            </div>
            <div className="flex-1 overflow-auto border border-gray-700 p-4 rounded-lg">
                {messages.map((msg) => {
                    const isMyMessage = msg.user === socket.id;

                    return (
                        <div key={msg._id} className={`flex ${isMyMessage ? "justify-end" : "justify-start"} mb-3`}>
                            <div className={`relative p-3 rounded-lg ${isMyMessage ? "bg-green-500 text-white" : "bg-gray-700 text-white"} max-w-[65%]`}>
                                <p className="text-sm font-semibold">{msg.user}</p>
                                {msg.replyTo && (
                                    <div className="bg-gray-800 p-2 rounded-lg mb-1 border-l-4 border-blue-500">
                                        <p className="text-sm text-gray-300">@{msg.replyTo.user ?? 'undefined'}</p>
                                        <p className="text-sm">{msg.replyTo.message ?? 'undefined'}</p>
                                    </div>
                                )}
                                {msg.imageUrl ? (
                                    <img src={msg.imageUrl} alt="Uploaded" className="mt-2 rounded-lg max-w-xs" />
                                ) : (
                                    <p className="text-white break-words">{msg.message}</p>
                                )}
                                <div className="absolute right-0 top-0">
                                    <button onClick={(e) => {
                                        e.stopPropagation(); 
                                        setShowOptions(msg._id);
                                    }}
                                     className="text-white hover:text-gray-500 p-1">⋮</button>
                                    {showOptions === msg._id && (
                                        <div ref={optionsRef} className="absolute z-10 right-0 top-8 bg-gray-700 p-2 rounded shadow-lg w-40">
                                            {isMyMessage && (
                                                <>
                                                    <button onClick={() => { editMessage(msg._id); setShowOptions(null); }} className="w-full text-left px-4 py-2 hover:bg-gray-600">Edit</button>
                                                    <button onClick={() => { deleteMessage(msg._id); setShowOptions(null); }} className="w-full text-left px-4 py-2 hover:bg-gray-600">Delete</button>
                                                </>
                                            )}
                                            {!isMyMessage && (
                                                <button onClick={() => { 
                                                    replyToMessage(msg); 
                                                    setShowOptions(null);
                                                 }} className="w-full text-left px-4 py-2 hover:bg-gray-600">Reply</button>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    );
                })}
                <div ref={messagesEndRef} />
            </div>

            {replyingTo && (
                <div className="bg-gray-800 p-2 mt-1 rounded-lg flex justify-between items-center">
                    <div>
                        <p className="text-gray-400 text-sm">Replying to <span className="font-semibold">{replyingTo.user}</span></p>
                        <p className="text-white text-sm truncate">{replyingTo.message}</p>
                    </div>
                    <button onClick={() => setReplyingTo(null)} className="text-red-400 hover:text-red-600 px-2">
                        ✖
                    </button>
                </div>
            )}

            <div className="flex items-center space-x-2 border border-gray-700 rounded-lg p-2 w-full">
                <button onClick={() => setShowEmojiPicker(!showEmojiPicker)} className="bg-gray-600 px-4 py-2 rounded">😀</button>
                {showEmojiPicker && (
                    <div className="absolute bottom-16 left-4 z-10">
                        <Picker data={emojiData} onEmojiSelect={addEmoji} />
                    </div>
                )}

                <label className="cursor-pointer bg-gray-600 px-4 py-2 rounded">
                    📷
                    <input type="file" accept="image/*" className="hidden" onChange={(e) => getRootProps().onDrop(e.target.files)} />
                </label>

                <label className="cursor-pointer bg-gray-600 px-4 py-2 rounded">
                    📁
                    <input type="file" className="hidden" onChange={(e) => getRootProps().onDrop(e.target.files)} />
                </label>

                <div className="flex-1 bg-gray-700 text-white p-2 rounded-lg focus:outline-none">
                    <EditorContent editor={editor} />
                </div>

                <button onClick={sendMessage} className="bg-green-600 px-4 py-2 rounded">Send</button>
            </div>
        </div>
    );
}
