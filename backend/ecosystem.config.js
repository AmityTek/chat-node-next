module.exports = {
  apps: [
    {
      name: "socket-server",
      script: "server.js",
      instances: "3", 
      exec_mode: "cluster",
      env: {
        PORT: 3010,
        MONGO_URI: "mongodb://localhost:27017/chat",
        REDIS_URL: "redis://localhost:6379"
      },
    },
  ],
};
