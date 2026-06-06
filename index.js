require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');

// MongoDB Connection
const MONGODB_URI = process.env.MONGODB_URI;
if (MONGODB_URI && MONGODB_URI !== 'YOUR_MONGODB_CONNECTION_STRING_HERE') {
  mongoose.connect(MONGODB_URI)
    .then(() => console.log('MongoDB Connected'))
    .catch(err => console.error('MongoDB Connection Error:', err));
} else {
  console.warn('WARNING: MONGODB_URI is not set or is default. Waiting for proper URI.');
}

// Schemas
const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  name: { type: String, required: true, unique: true },
  age: { type: Number, required: true },
  gender: { type: String, required: true },
  avatar: { type: String, default: null },
  friends: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  friendRequests: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }]
});

// Message Schema
const messageSchema = new mongoose.Schema({
  sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  receiver: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  text: { type: String, required: true },
  timestamp: { type: Number, default: Date.now }
});

const User = mongoose.model('User', userSchema);
const Message = mongoose.model('Message', messageSchema);

// App initialization
const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const server = http.createServer(app);

// Basic health check
app.get('/', (req, res) => {
  res.send('Universe Server is running! Database integration active.');
});

// Authentication Routes
app.post('/api/signup', async (req, res) => {
  try {
    const { email, password, name, age, gender } = req.body;
    if (!email || !password || !name) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    if (!MONGODB_URI || MONGODB_URI === 'YOUR_MONGODB_CONNECTION_STRING_HERE') {
      return res.status(500).json({ error: 'Database is not configured yet. Please set MONGODB_URI.' });
    }

    const existingEmail = await User.findOne({ email });
    if (existingEmail) return res.status(400).json({ error: 'Email already exists' });

    const existingName = await User.findOne({ name });
    if (existingName) return res.status(400).json({ error: 'Username already taken' });

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = await User.create({
      email, password: hashedPassword, name, age, gender
    });

    res.json({ id: newUser._id, email, name, age, gender, avatar: newUser.avatar, friends: newUser.friends, friendRequests: newUser.friendRequests });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Missing credentials' });

    if (!MONGODB_URI || MONGODB_URI === 'YOUR_MONGODB_CONNECTION_STRING_HERE') {
      return res.status(500).json({ error: 'Database is not configured yet. Please set MONGODB_URI.' });
    }

    const user = await User.findOne({ $or: [{ email: email }, { name: email }] });
    if (!user) return res.status(400).json({ error: 'Invalid credentials' });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ error: 'Invalid credentials' });

    res.json({ id: user._id, email: user.email, name: user.name, age: user.age, gender: user.gender, avatar: user.avatar, friends: user.friends, friendRequests: user.friendRequests });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/update-profile', async (req, res) => {
  try {
    const { id, avatar, name, age, gender, email } = req.body;
    if (!id) return res.status(400).json({ error: 'Missing user ID' });

    // Check unique constraints
    if (email) {
      const existing = await User.findOne({ email, _id: { $ne: id } });
      if (existing) return res.status(400).json({ error: 'Email already in use' });
    }
    if (name) {
      const existing = await User.findOne({ name, _id: { $ne: id } });
      if (existing) return res.status(400).json({ error: 'Username already taken' });
    }

    const updates = {};
    if (avatar !== undefined) updates.avatar = avatar;
    if (name !== undefined) updates.name = name;
    if (age !== undefined) updates.age = age;
    if (gender !== undefined) updates.gender = gender;
    if (email !== undefined) updates.email = email;

    const user = await User.findByIdAndUpdate(id, updates, { new: true });
    if (!user) return res.status(404).json({ error: 'User not found' });

    res.json({ id: user._id, email: user.email, name: user.name, age: user.age, gender: user.gender, avatar: user.avatar, friends: user.friends, friendRequests: user.friendRequests });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Friend Routes
app.post('/api/friends/request', async (req, res) => {
  try {
    const { fromId, toId } = req.body;
    const toUser = await User.findById(toId);
    
    if (!toUser) return res.status(404).json({ error: 'User not found' });
    if (toUser.friends.includes(fromId)) return res.status(400).json({ error: 'Already friends' });
    if (toUser.friendRequests.includes(fromId)) return res.status(400).json({ error: 'Request already sent' });

    toUser.friendRequests.push(fromId);
    await toUser.save();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/friends/accept', async (req, res) => {
  try {
    const { fromId, toId } = req.body;
    const toUser = await User.findById(toId);
    const fromUser = await User.findById(fromId);

    if (!toUser || !fromUser) return res.status(404).json({ error: 'User not found' });

    toUser.friendRequests = toUser.friendRequests.filter(id => id.toString() !== fromId);
    if (!toUser.friends.includes(fromId)) toUser.friends.push(fromId);
    if (!fromUser.friends.includes(toId)) fromUser.friends.push(toId);

    await toUser.save();
    await fromUser.save();

    res.json({ success: true, friendRequests: toUser.friendRequests, friends: toUser.friends });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/friends/reject', async (req, res) => {
  try {
    const { fromId, toId } = req.body;
    const toUser = await User.findById(toId);

    if (!toUser) return res.status(404).json({ error: 'User not found' });

    toUser.friendRequests = toUser.friendRequests.filter(id => id.toString() !== fromId);
    await toUser.save();

    res.json({ success: true, friendRequests: toUser.friendRequests });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/friends/:id', async (req, res) => {
  try {
    const user = await User.findById(req.params.id)
      .populate('friends', '_id name avatar')
      .populate('friendRequests', '_id name avatar');

    if (!user) return res.status(404).json({ error: 'User not found' });

    const populatedFriends = user.friends.map(f => ({
      id: f._id, name: f.name, avatar: f.avatar, status: onlineUsers[f._id] ? 'online' : 'offline'
    }));

    const populatedRequests = user.friendRequests.map(r => ({
      id: r._id, name: r.name, avatar: r.avatar
    }));

    res.json({ friends: populatedFriends, friendRequests: populatedRequests });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/messages/:userId/:friendId', async (req, res) => {
  try {
    const { userId, friendId } = req.params;
    const chatHistory = await Message.find({
      $or: [
        { sender: userId, receiver: friendId },
        { sender: friendId, receiver: userId }
      ]
    }).sort({ timestamp: 1 });

    const formattedHistory = chatHistory.map(m => ({
      id: m._id, sender: m.sender, receiver: m.receiver, text: m.text, timestamp: m.timestamp
    }));

    res.json(formattedHistory);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

let waitingUsers = {};
let onlineUsers = {}; 

io.on('connection', (socket) => {
  socket.on('register', (userId) => {
    onlineUsers[userId] = socket.id;
    socket.userId = userId;
    io.emit('user_status_change', { userId, status: 'online' });
  });

  socket.on('join_queue', (data) => {
    const userInfo = data.userInfo || data;
    const topic = data.topic || 'global';
    
    socket.userInfo = userInfo;
    socket.currentTopic = topic;
    
    if (!waitingUsers[topic]) waitingUsers[topic] = [];
    
    if (waitingUsers[topic].length > 0) {
      const partner = waitingUsers[topic].find(u => u !== socket.id);
      if (partner) {
        waitingUsers[topic] = waitingUsers[topic].filter(u => u !== partner);
        
        const roomName = `room-${partner}-${socket.id}`;
        socket.join(roomName);
        const partnerSocket = io.sockets.sockets.get(partner);
        if (partnerSocket) partnerSocket.join(roomName);
        
        socket.emit('match_found', { room: roomName, role: 'receiver', partnerInfo: partnerSocket ? partnerSocket.userInfo : null });
        io.to(partner).emit('match_found', { room: roomName, role: 'initiator', partnerInfo: socket.userInfo });
      } else {
        waitingUsers[topic].push(socket.id);
      }
    } else {
      if (!waitingUsers[topic].includes(socket.id)) waitingUsers[topic].push(socket.id);
    }
  });

  socket.on('offer', (data) => socket.to(data.room).emit('offer', data.offer));
  socket.on('answer', (data) => socket.to(data.room).emit('answer', data.answer));
  socket.on('ice_candidate', (data) => socket.to(data.room).emit('ice_candidate', data.candidate));
  socket.on('chat_message', (data) => socket.to(data.room).emit('chat_message', data.message));
  socket.on('leave_room', (room) => { socket.leave(room); socket.to(room).emit('partner_left'); });

  socket.on('send_friend_request', ({ fromUser, toId }) => {
    const targetSocket = onlineUsers[toId];
    if (targetSocket) io.to(targetSocket).emit('receive_friend_request', { fromUser });
  });

  socket.on('send_direct_message', async (data) => {
    const { senderId, receiverId, message, timestamp } = data;
    
    try {
      const newMsg = await Message.create({ sender: senderId, receiver: receiverId, text: message, timestamp });
      const targetSocket = onlineUsers[receiverId];
      if (targetSocket) {
        io.to(targetSocket).emit('receive_direct_message', {
          id: newMsg._id, sender: newMsg.sender, receiver: newMsg.receiver, text: newMsg.text, timestamp: newMsg.timestamp
        });
      }
    } catch (err) {
      console.error('Error saving direct message:', err);
    }
  });

  socket.on('disconnecting', () => {
    if (socket.currentTopic && waitingUsers[socket.currentTopic]) {
      waitingUsers[socket.currentTopic] = waitingUsers[socket.currentTopic].filter(u => u !== socket.id);
    }
    socket.rooms.forEach(room => {
      if (room !== socket.id) socket.to(room).emit('partner_left');
    });
  });

  socket.on('disconnect', () => {
    if (socket.userId) {
      delete onlineUsers[socket.userId];
      io.emit('user_status_change', { userId: socket.userId, status: 'offline' });
    }
  });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
