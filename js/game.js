const canvasEl = document.querySelector('#game')
const canvas = canvasEl.getContext('2d')
const playersDiv = document.querySelector('#players')
const logDiv = document.querySelector('#log')
const chooseCharDiv = document.querySelector('#chooseChar')
const playButDiv = document.querySelector('#play')
const firegirl = new Image()
const waterboy = new Image()
const block = new Image()
const background = new Image()
firegirl.src = '../images/wauver.png'
waterboy.src = '../images/fiyaa.png'
block.src = '../images/block.png'
background.src = '../images/background.png'




const xhr = new XMLHttpRequest()
let map
xhr.onload = () => {
   map = JSON.parse(xhr.response)
}
xhr.open('get', '../maps/level1.json')
xhr.send()








function addPlayerToDiv(usrname)
{
   const spanEl = document.createElement('span')
   spanEl.classList += 'player'
   spanEl.id = usrname
   spanEl.innerText = usrname
   playersDiv.appendChild(spanEl)
}

function removePlayerFromDiv(usrname)
{
   document.getElementById(usrname).remove()
}

socket.emit('plrInfo', {username, room})


socket.on('otherUsernames', (usernames) => {
   usernames.forEach(({username: usrname}) => {
      addPlayerToDiv(usrname)
   })
})


socket.on('player+', (plrUsername) => {
   addPlayerToDiv(plrUsername)
})


socket.on('player-', (plrUsername) => {
   removePlayerFromDiv(plrUsername)
})


socket.on('chooseChars', () => {
   canvasEl.style.display = 'inline'
   chooseCharDiv.style.display = 'inline'
   playButDiv.style.display = 'none'
})

socket.on('startPlay', () => {
   let xvel = 0, yvel = 0
   let xnew, ynew
   const pressedKeys = {}


   // android buttons
   /* sorry android, not now
   if (window.navigator.userAgent.toLowerCase().indexOf('android') !== -1)
   {
      const butSize = 0.14 * window.innerWidth

      const butUp = document.createElement('button')
      butUp.classList = 'android_button'
      butUp.style.
      left = butSize + butSize/2
      butUp.style.bottom = butSize + butSize + butSize/2
      butUp.style.width = butSize
      butUp.style.height = butSize
      butUp.ontouchstart = () => {up = 1}
      butUp.ontouchend = () => {up = 0}
      butUp.innerText = '^'
      document.body.appendChild(butUp)

      const butLeft = document.createElement('button')
      butLeft.classList = 'android_button'
      butLeft.style.left = butSize/2
      butLeft.style.bottom = butSize + butSize/2
      butLeft.style.width = butSize
      butLeft.style.height = butSize
      butLeft.ontouchstart = () => {left = 1}
      butLeft.ontouchend = () => {left = 0}
      butLeft.innerText = '<'
      document.body.appendChild(butLeft)

      const butDown = document.createElement('button')
      butDown.classList = 'android_button'
      butDown.style.left = butSize + butSize/2
      butDown.style.bottom = butSize/2
      butDown.style.width = butSize
      butDown.style.height = butSize
      butDown.ontouchstart = () => {down = 1}
      butDown.ontouchend = () => {down = 0}
      butDown.innerText = 'd'
      document.body.appendChild(butDown)

      const butRight = document.createElement('button')
      butRight.classList = 'android_button'
      butRight.style.left = butSize + butSize + butSize/2
      butRight.style.bottom = butSize + butSize/2
      butRight.style.width = butSize
      butRight.style.height = butSize
      butRight.ontouchstart = () => {right = 1}
      butRight.ontouchend = () => {right = 0}
      butRight.innerText = '>'
      document.body.appendChild(butRight)
   }
   */

   document.onkeydown = (event) => {
      pressedKeys[event.key.toLowerCase()] = 1
   }

   document.onkeyup = (event) => {
      pressedKeys[event.key.toLowerCase()] = 0
   }

   socket.on('coords', ({x: x, y: y}) => {
      yo.x = x;
      yo.y = y;
   })

   // GAME LOOP!
   // 29 blocks vertically, 39 blocks horizontally
   // 20px each block, 20px remaining space
   setInterval(() => {

      if (pressedKeys['w'] && pressedKeys['s'])
         {}
      else if (pressedKeys['w'])
         yvel = Math.max(-1.5, yvel - 0.1)
      else if (pressedKeys['s'])
         yvel = Math.min(1.5, yvel + 0.1)
      else
         yvel = 0

      if (pressedKeys['a'] && pressedKeys['d'])
         {}
      else if (pressedKeys['a'])
         xvel = Math.max(-1.5, xvel - 0.1)
      else if (pressedKeys['d'])
         xvel = Math.min(1.5, xvel + 0.1)
      else
         xvel = 0

      xnew = me.x + xvel
      ynew = me.y + yvel

      if (!(xnew === me.x && ynew === me.y))
      {
         if (xnew < 0)
            xnew = 0
         if (ynew < 0)
            ynew = 0
         if (xnew > canvasEl.width - 20)
            xnew = canvasEl.width - 20
         if (ynew > canvasEl.height - 20)
            ynew = canvasEl.height - 20

         const fixed = fixCollisions(xnew, ynew)

         me.x = fixed.x
         me.y = fixed.y
         socket.emit('coords', {x: me.x, y: me.y})
      }

      canvas.clearRect(0, 0, canvasEl.width, canvasEl.height)
      canvas.drawImage(background, 0, 0, canvasEl.width, canvasEl.height) // background image
      canvas.drawImage(yo.image, yo.x, yo.y, 20, 20)
      canvas.drawImage(me.image, me.x, me.y, 20, 20)
      for (let i = 0; i < 29; ++i)
         for (let j = 0; j < 39; ++j)
            if (map[i][j] === 1)
               canvas.drawImage(block, j*20, i*20, 20, 20) // OX != i, OY != j
   }, 13)
})


socket.on('log', (msg) => {
   addLog(msg)
})

function addLog(msg)
{
   const date = new Date()
   const spanEl = document.createElement('span')
   spanEl.classList += 'logmsg'
   spanEl.innerText = 'log ' + date.getHours() + ':' + date.getMinutes() + ':' + date.getSeconds() + ' - ' + msg
   logDiv.appendChild(spanEl)
}

function play()
{
   socket.emit('tryPlay')
}