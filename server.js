const express = require('express')
const http = require('http')
const socketio = require('socket.io')
const PORT = process.env.PORT || 3000
const app = express()
app.get('*', (req, res) => {
   res.sendFile(req.path, { root: __dirname })
})

const server = http.createServer(app)
const io = new socketio.Server(server)

const users = []

io.on('connection', (socket) => {
   let username
   let room
   const id = socket.id

   socket.on('plrInfo', ({username: usrname, room: rom}) => {
      username = usrname
      room = rom

      if (users[room] === undefined)
         users[room] = []

      users[room].push({username: username, id: id})
      socket.emit('otherUsernames', users[room])

      socket.join(room)
      socket.in(room).emit('player+', username)
   })


   socket.on('tryPlay', () => {
      io.in(room).emit('log', `Player ${username} tried to start the game.`)

      if (users[room].length > 2)
         io.in(room).emit('log', `Too many players! ${users[room].length - 2} players need to leave from this room.`)
      else if (users[room].length < 2)
         io.in(room).emit('log', `Too few players! ${2 - users[room].length} players need to enter in this room.`)
      else
      {
         io.in(room).emit('log', 'Choose your characters.')
         io.in(room).emit('chooseChars')
      }
   })


   socket.on('coords', ({x: x, y: y}) => {
      socket.in(room).emit('coords', {x: x, y: y});
   })


   socket.on('chooseFiregirl', () => {
      if (users[room] === undefined)
         return

      users[room].find(({username: usrname}) => (usrname === username)).character = 'firegirl'
      io.in(room).emit('log', `Player ${username} chose Firegirl.`)
      if (users[room].find(({username: usrname}) => (usrname !== username)).character !== undefined)
         io.in(room).emit('startPlay')
   })

   socket.on('chooseWaterboy', () => {
      if (users[room] === undefined)
         return

      users[room].find(({username: usrname}) => (usrname === username)).character = 'waterboy'
      io.in(room).emit('log', `Player ${username} chose Waterboy.`)
      if (users[room].find(({username: usrname}) => (usrname !== username)).character !== undefined)
         io.in(room).emit('startPlay')
   })


   socket.on('levelFinish', () => {
      users[room].find(({username: usrname}) => (usrname === username)).levelFinished = true

      if (users[room].find(({username: usrname}) => (usrname !== username)).levelFinished === true)
      {
         io.in(room).emit('nextLevel')
         users[room].forEach(user => {
            user.levelFinished = false
         })
      }
   })


   socket.on('disconnect', () => {
      if (users[room] === undefined)
         return

      const index = users[room].findIndex( ({username: usrname}) => (username === usrname) )
      users[room].splice(index, 1)
      socket.in(room).emit('player-', username)
   })
})

server.listen(parseInt(PORT), () => {
   console.log(`Server-ul functioneaza pe portul ${PORT}.`)
})