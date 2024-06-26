const express = require("express");
const http = require("http");
const socketIO = require("socket.io");
const cors = require("cors");

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
  cors: {
    origin: "*", // replace with your React app's URL
    methods: ["GET", "POST"],
    pingInterval: 100, // 10 seconds
    pingTimeout: 100, // 5 seconds
  },
});
app.use(cors());

const rooms = {};
const connectedUsers = {}; // Store connected users


io.on("connection", (socket) => {
  console.log("A user connected");

  socket.on("resetBoard", (roomId) => {
    const room = rooms[roomId];
    resetBoard(room);
  });

  // Receive user ID from React.js
  socket.on("setUserId", (userId) => {
    // Store the user ID in the connectedUsers object with isOnline set to true
    connectedUsers[socket.id] = { userId, isOnline: true };

    // Send the list of connected users to React.js
    io.emit("connectedUsers", Object.values(connectedUsers));
  });

  socket.on("joinRoom", (roomId, playerName, playerId, isOnline) => {
    if (!rooms[roomId]) {
      rooms[roomId] = {
        players: [],
        currentPlayer: null,
        board: Array(25).fill(null),
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
      online: isOnline, // Set online status to true initially
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
    io.to(roomId).emit("playerJoined", playerName);

    console.log(`${playerName} joined room ${roomId}`);

    if (rooms[roomId].players.length === 2) {
      // Start the game when there are two players
      startGame(roomId);
    }
  });

  socket.on("makeMove", (roomId, index) => {
    const room = rooms[roomId];

    // Check if it's the player's turn and the move is valid
    if (
      socket.id === room.currentPlayer &&
      room.board[index] === null &&
      !calculateWinner(room.board)
    ) {
      room.board[index] = room.currentPlayer === room.players[0].id ? "X" : "O";

      // Check for a winner or draw
      const winner = calculateWinner(room.board);
      if (winner) {
        // Update points
        updatePoints(room, winner);

        // Inform clients about the winner and reset the board
        io.to(roomId).emit("gameOver", {
          winner,
          points: room.points,
          players: room.players.map((player) => ({
            name: player.name,
            playerId: player.playerId,
          })),
        });

        resetBoard(room);
        // No need to reset the board here; it will be done on the frontend
      } else if (room.board.every((cell) => cell !== null)) {
        // Draw
        room.points[room.players[0].name]++;
        room.points[room.players[1].name]++;
        io.to(roomId).emit("gameOver", {
          draw: true,
          points: room.points,
          players: room.players.map((player) => ({
            name: player.name,
            playerId: player.playerId,
          })),
        });
        // No need to reset the board here; it will be done on the frontend
        resetBoard(room);
      } else {
        // Switch turns
        room.currentPlayer =
          room.currentPlayer === room.players[0].id
            ? room.players[1].id
            : room.players[0].id;
        io.to(roomId).emit("updateBoard", {
          board: room.board,
          currentPlayer: room.currentPlayer,
          currentPlayerName: getCurrentPlayerName(room),
        });
        socket.to(roomId).emit("waitingForTurn");
      }
    }
  });

  // Listen for the "newGame" event triggered by the frontend
  socket.on("newGame", (roomId) => {
    resetBoard(roomId);
  });

  socket.on("disconnect", () => {

    
    const roomId = Object.keys(rooms).find((key) =>
    rooms[key].players.some((player) => player.id === socket.id)
);

if (roomId) {
    const room = rooms[roomId];
    const player = room.players.find((player) => player.id === socket.id);

    if (player) {
        // Set isOnline to false for the disconnected player
        player.isOnline = false;

        // Remove the player from the room
        room.players = room.players.filter((player) => player.id !== socket.id);

        // Notify remaining players about the disconnected player
        io.to(roomId).emit("playerLeft", player.name, player.isOnline);

        // If there is only one player remaining, reset the game
        if (room.players.length === 1) {
            resetBoard(roomId);
        }

        // Broadcast the updated list of connected users to the remaining players
        io.to(roomId).emit("connectedUsers", room.players);
    }
}

  });
});

function startGame(roomId) {
  const room = rooms[roomId];
// Check if room and players array exist
if (room && room.players && room.players.length >= 2) {
  // Reset points when starting a new game
  room.points = {
    [room.players[0]?.name]: 0,
    [room.players[1]?.name]: 0,
  };
}
  // Randomly select the starting player
  room.currentPlayer =
    Math.random() < 0.5 ? room.players[0].id : room.players[1].id;
  io.to(roomId).emit("startGame", {
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

  room.board = Array(25).fill(null);
  room.currentPlayer =
    room.currentPlayer === room.players[0].id
      ? room.players[1].id
      : room.players[0].id;

  io.to(room.players[0].id).emit("updateBoard", {
    board: room.board,
    currentPlayer: room.currentPlayer,
    currentPlayerName: getCurrentPlayerName(room),
  });
  io.to(room.players[1].id).emit("updateBoard", {
    board: room.board,
    currentPlayer: room.currentPlayer,
    currentPlayerName: getCurrentPlayerName(room),
  });
}

function calculateWinner(board) {
  const size = 5; // Adjusted for a 5x5 grid
  // Horizontal and Vertical checks
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      // Check horizontal line for four in a row
      if (col <= size - 4 && board[row * size + col] && board[row * size + col] === board[row * size + col + 1] && board[row * size + col] === board[row * size + col + 2] && board[row * size + col] === board[row * size + col + 3]) {
        return board[row * size + col];
      }
      // Check vertical line for four in a row
      if (row <= size - 4 && board[row * size + col] && board[row * size + col] === board[(row + 1) * size + col] && board[row * size + col] === board[(row + 2) * size + col] && board[row * size + col] === board[(row + 3) * size + col]) {
        return board[row * size + col];
      }
    }
  }
  // Diagonal checks for four in a row
  for (let row = 0; row <= size - 4; row++) {
    for (let col = 0; col <= size - 4; col++) {
      // Check down-right ( \ ) diagonal
      if (board[row * size + col] && board[row * size + col] === board[(row + 1) * size + col + 1] && board[row * size + col] === board[(row + 2) * size + col + 2] && board[row * size + col] === board[(row + 3) * size + col + 3]) {
        return board[row * size + col];
      }
      // Check down-left ( / ) diagonal (starting from the right)
      if (board[(row + 3) * size + col] && board[(row + 3) * size + col] === board[(row + 2) * size + col + 1] && board[(row + 3) * size + col] === board[(row + 1) * size + col + 2] && board[(row + 3) * size + col] === board[row * size + col + 3]) {
        return board[(row + 3) * size + col];
      }
    }
  }
  // Additionally, check the anti-diagonal from left to right for four in a row
  for (let row = 0; row <= size - 4; row++) {
    for (let col = 3; col < size; col++) {
      // Check up-right ( / ) diagonal
      if (board[row * size + col] && board[row * size + col] === board[(row + 1) * size + col - 1] && board[row * size + col] === board[(row + 2) * size + col - 2] && board[row * size + col] === board[(row + 3) * size + col - 3]) {
        return board[row * size + col];
      }
    }
  }
  // No winner found
  return null;
}



function updatePoints(room, winner) {
  if (winner === "X") {
    room.points[room.players[0].name] += 3;
  } else {
    room.points[room.players[1].name] += 3;
  }

  // Emit points in the correct format
  io.to(room.players[0].id).emit("updatePoints", { points: room.points });
  io.to(room.players[1].id).emit("updatePoints", { points: room.points });
}

function getCurrentPlayerName(room) {
  return room.currentPlayer === room.players[0].id
    ? room.players[0].name
    : room.players[1].name;
}

const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

