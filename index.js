const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);

// Basic health check route
app.get('/', (req, res) => {
  res.send('Universe Signaling Server is running smoothly!');
});

const io = new Server(server, {
  cors: {
    origin: "*", // allow any origin for local dev
    methods: ["GET", "POST"]
  }
});

// A waiting queue for random matching
let waitingUsers = [];

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('join_queue', (userInfo) => {
    console.log('User joined queue:', socket.id, userInfo);
    socket.userInfo = userInfo;
    
    // Check if there is someone waiting
    if (waitingUsers.length > 0) {
      // Don't pair with yourself
      const partner = waitingUsers.find(u => u !== socket.id);
      
      if (partner) {
        // Remove partner from waiting queue
        waitingUsers = waitingUsers.filter(u => u !== partner);
        
        // Create a room name
        const roomName = `room-${partner}-${socket.id}`;
        
        // Join both users to the room
        socket.join(roomName);
        const partnerSocket = io.sockets.sockets.get(partner);
        if (partnerSocket) {
          partnerSocket.join(roomName);
        }

        console.log(`Paired ${socket.id} with ${partner} in ${roomName}`);
        
        // Tell both users they are matched, and assign roles (initiator / receiver)
        socket.emit('match_found', { 
          room: roomName, 
          role: 'receiver', 
          partnerInfo: partnerSocket ? partnerSocket.userInfo : null 
        });
        io.to(partner).emit('match_found', { 
          room: roomName, 
          role: 'initiator', 
          partnerInfo: socket.userInfo 
        });
      } else {
        waitingUsers.push(socket.id);
      }
    } else {
      // Nobody waiting, add to queue
      if (!waitingUsers.includes(socket.id)) {
        waitingUsers.push(socket.id);
      }
    }
  });

  // WebRTC Signaling
  socket.on('offer', (data) => {
    socket.to(data.room).emit('offer', data.offer);
  });

  socket.on('answer', (data) => {
    socket.to(data.room).emit('answer', data.answer);
  });

  socket.on('ice_candidate', (data) => {
    socket.to(data.room).emit('ice_candidate', data.candidate);
  });
  
  // Chat message
  socket.on('chat_message', (data) => {
    socket.to(data.room).emit('chat_message', data.message);
  });

  socket.on('leave_room', (room) => {
    socket.leave(room);
    socket.to(room).emit('partner_left');
  });

  socket.on('disconnecting', () => {
    console.log('User disconnecting:', socket.id);
    waitingUsers = waitingUsers.filter(u => u !== socket.id);
    socket.rooms.forEach(room => {
      if (room !== socket.id) {
        socket.to(room).emit('partner_left');
      }
    });
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`Signaling server running on port ${PORT}`);
});
