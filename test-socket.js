const io = require("socket.io-client");
const socket = io("http://localhost:4000");

socket.on("connect", () => {
  console.log("Connected to server!");
  socket.emit("register", "testUserId123");
  
  socket.emit("request_call", { toId: "testUserId123", fromInfo: { id: "testUserId123", name: "Test" } });
});

socket.on("incoming_call", (data) => {
  console.log("Received incoming call!", data);
  process.exit(0);
});

setTimeout(() => {
  console.log("Timeout waiting for incoming call");
  process.exit(1);
}, 3000);
