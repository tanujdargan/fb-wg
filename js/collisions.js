// every block has a size of 20px
function colliding(x, y, xblock, yblock)
{
   let zone = ''
   let area, areaMax = 0

   if (xblock-19 <= x && x <= xblock+19 && yblock-19 <= y && y <= yblock-1)
   {
      area = Math.min(xblock+20, x+20) - Math.max(xblock, x)
      if (area > areaMax)
      {
         areaMax = area
         zone = 'n'
      }
   }
   if (xblock-19 <= x && x <= xblock-1 && yblock-19 <= y && y <= yblock+19)
   {
      area = Math.min(yblock+20, y+20) - Math.max(yblock, y)
      if (area > areaMax)
      {
         areaMax = area
         zone = 'v'
      }
   }
   if (xblock-19 <= x && x <= xblock+19 && yblock+1 <= y && y <= yblock+19)
   {
      area = Math.min(xblock+20, x+20) - Math.max(xblock, x)
      if (area > areaMax)
      {
         areaMax = area
         zone = 's'
      }
   }
   if (xblock+1 <= x && x <= xblock+19 && yblock-19 <= y && y <= yblock+19)
   {
      area = Math.min(yblock+20, y+20) - Math.max(yblock, y)
      if (area > areaMax)
      {
         areaMax = area
         zone = 'e'
      }
   }

   return zone
}


// returns the fixed x and y coords
function fixCollisions(x, y)
{
   for (let i = 0; i < 29; ++i)
      for (let j = 0; j < 39; ++j)
         if (map[i][j] === 1)
         {
            const zone = colliding(x, y, j*20, i*20)
            switch (zone)
            {
               case 'n':
                  y = i*20-20;   break;
               case 'v':
                  x = j*20-20;   break;
               case 's':
                  y = i*20+20;   break;
               case 'e':
                  x = j*20+20;   break;
            }
         }

   return {x: x, y: y}
}