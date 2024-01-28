const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
    cors: {
        origin: "*", // replace with your React app's URL
        methods: ["GET", "POST"],
        pingInterval: 100, // 10 seconds
        pingTimeout: 100, // 5 seconds
    }
});
app.use(cors());

const rooms = {};
const connectedUsers = {}; // Store connected users


io.on('connection', (socket) => {
    console.log('A user connected');

    socket.on('resetBoard', (roomId) => {
        const room = rooms[roomId];
        resetBoard(room);
    });

            // Receive user ID from React.js
            socket.on('setUserId', (userId) => {
              // Store the user ID in the connectedUsers object with isOnline set to true
              connectedUsers[socket.id] = { userId, isOnline: true };
      
              // Send the list of connected users to React.js
              io.emit('connectedUsers', Object.values(connectedUsers));
          });
    

    socket.on('joinRoom', (roomId, playerName, playerId) => {
        if (!rooms[roomId]) {
            rooms[roomId] = {
                players: [],
                currentPlayer: null,
                board: Array(9).fill(null),
                points: {
                    [playerName]: 0,
                    opponent: 0,
                },
            };
        }

        rooms[roomId].players.push({
            id: socket.id,
            name: playerName,
            playerId: playerId,
            online: true, // Set online status to true initially
            typing: false, // Set typing status to false initially
        });

        socket.on('typing', (roomId, isTyping, playerName) => {
          const room = rooms[roomId];
          const player = room.players.find((p) => p.id === socket.id);
          player.typing = isTyping;
  
          // Broadcast typing status to the other player in the room
          socket.to(roomId).emit('opponentTyping', isTyping, playerName);
      });

        socket.join(roomId);
        io.to(roomId).emit('playerJoined', playerName);

        console.log(`${playerName} joined room ${roomId}`);

        if (rooms[roomId].players.length === 2) {
            // Start the game when there are two players
            startGame(roomId);
        }
    });

    socket.on('makeMove', (roomId, index) => {
        const room = rooms[roomId];

        // Check if it's the player's turn and the move is valid
        if (socket.id === room.currentPlayer && room.board[index] === null && !calculateWinner(room.board)) {
            room.board[index] = room.currentPlayer === room.players[0].id ? 'X' : 'O';

            // Check for a winner or draw
            const winner = calculateWinner(room.board);
            if (winner) {
                // Update points
                updatePoints(room, winner);

                // Inform clients about the winner and reset the board
                io.to(roomId).emit('gameOver', {
                    winner,
                    points: room.points,
                    players: room.players.map(player => ({ name: player.name, playerId: player.playerId })),
                });

                resetBoard(room);
                // No need to reset the board here; it will be done on the frontend
            } else if (room.board.every((cell) => cell !== null)) {
                // Draw
                room.points[room.players[0].name]++;
                room.points[room.players[1].name]++;
                io.to(roomId).emit('gameOver', {
                    draw: true,
                    points: room.points,
                    players: room.players.map(player => ({ name: player.name, playerId: player.playerId })),
                });
                // No need to reset the board here; it will be done on the frontend
                resetBoard(room);
            } else {
                // Switch turns
                room.currentPlayer = room.currentPlayer === room.players[0].id ? room.players[1].id : room.players[0].id;
                io.to(roomId).emit('updateBoard', {
                    board: room.board,
                    currentPlayer: room.currentPlayer,
                    currentPlayerName: getCurrentPlayerName(room),
                });
                socket.to(roomId).emit('waitingForTurn');
            }
        }
    });

    // Listen for the "newGame" event triggered by the frontend
    socket.on('newGame', (roomId) => {
        resetGame(roomId);
    });

    socket.on('disconnect', () => {
      console.log(`User disconnected: ${socket.id}`);

      // Set the isOnline property to false for the disconnected user
      if (connectedUsers[socket.id]) {
          connectedUsers[socket.id].isOnline = false;
      }

      // Send the updated list of connected users to React.js
      io.emit('connectedUsers', Object.values(connectedUsers));

        const roomId = Object.keys(rooms).find((key) => rooms[key].players.some((player) => player.id === socket.id));

        if (roomId) {
            const player = rooms[roomId].players.find((player) => player.id === socket.id);

            // Remove the player from the room
            rooms[roomId].players = rooms[roomId].players.filter((player) => player.id !== socket.id);

            // Notify remaining players about the disconnected player
            io.to(roomId).emit('playerLeft', player.name);

                                  // Player found, clear typing status
                                  player.typing = false;

                                  // Broadcast the updated typing status to the other player in the room
                                  socket.to(roomId).emit('opponentTyping', false, player.name);
                      

            // If there is only one player remaining, reset the game
            if (rooms[roomId].players.length === 1) {
                resetGame(roomId);
            }
        }
    });
});

function startGame(roomId) {
    const room = rooms[roomId];
    // Reset points when starting a new game
    room.points = {
        [room.players[0].name]: 0,
        [room.players[1].name]: 0,
    };
    // Randomly select the starting player
    room.currentPlayer = Math.random() < 0.5 ? room.players[0].id : room.players[1].id;
    io.to(roomId).emit('startGame', {
        board: room.board,
        currentPlayer: room.currentPlayer,
        currentPlayerName: getCurrentPlayerName(room),
    });
}

function resetBoard(room) {
    // Reset points array when restarting
    room.points = {
        [room.players[0].name]: 0,
        [room.players[1].name]: 0,
    };

    room.board = Array(9).fill(null);
    room.currentPlayer = room.currentPlayer === room.players[0].id ? room.players[1].id : room.players[0].id;

    io.to(room.players[0].id).emit('updateBoard', {
        board: room.board,
        currentPlayer: room.currentPlayer,
        currentPlayerName: getCurrentPlayerName(room),
    });
    io.to(room.players[1].id).emit('updateBoard', {
        board: room.board,
        currentPlayer: room.currentPlayer,
        currentPlayerName: getCurrentPlayerName(room),
    });
}

function calculateWinner(board) {
    const winningLines = [
        [0, 1, 2],
        [3, 4, 5],
        [6, 7, 8],
        [0, 3, 6],
        [1, 4, 7],
        [2, 5, 8],
        [0, 4, 8],
        [2, 4, 6],
    ];

    for (let i = 0; i < winningLines.length; i++) {
        const [a, b, c] = winningLines[i];
        if (board[a] && board[a] === board[b] && board[a] === board[c]) {
            return board[a];
        }
    }

    return null;
}

function updatePoints(room, winner) {
    if (winner === 'X') {
        room.points[room.players[0].name] += 3;
    } else {
        room.points[room.players[1].name] += 3;
    }

    // Emit points in the correct format
    io.to(room.players[0].id).emit('updatePoints', { points: room.points });
    io.to(room.players[1].id).emit('updatePoints', { points: room.points });
}

function getCurrentPlayerName(room) {
    return room.currentPlayer === room.players[0].id ? room.players[0].name : room.players[1].name;
}

const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
