-- Portable checks for the mirror window; the picture itself needs a Mac.
local source = SCRIPT_SOURCE
if not source then
  local file = assert(io.open("scripts/hammerspoon/jan-remote.lua", "r"))
  source = file:read("*a")
  file:close()
end
local types = { flagsChanged = 12, keyDown = 10, leftMouseDown = 1, rightMouseDown = 3, scrollWheel = 22 }
local now, later, settings, alerts = 0, {}, {}, {}
local pointer, buttons = { x = 500, y = 300 }, { left = false }
local canvases = {}
local function newCanvas(frame)
  local c = { elements = {}, shown = false, deleted = false, box = frame }
  local mt = { __index = function(t, k)
    if type(k) == "number" then return t.elements[k] end
    return rawget(t, k)
  end }
  setmetatable(c, mt)
  function c:appendElements(...) for _, el in ipairs({ ... }) do self.elements[#self.elements + 1] = el end end
  function c:frame(f) if f then self.box = f end return self.box end
  function c:canvasMouseEvents() end
  function c:mouseCallback(fn) self.onMouse = fn end
  function c:clickActivating(v) self.activates = v end
  function c:level() end
  function c:behavior() end
  function c:show() self.shown = true end
  function c:delete() self.deleted = true end
  canvases[#canvases + 1] = c
  return c
end
local timers = {}
local function timer(fn) local t = { fn = fn, running = true } function t:stop() self.running = false end timers[#timers + 1] = t return t end
local screen = {
  fullFrame = function() return { x = 0, y = 0, w = 1440, h = 900 } end,
  frame = function() return { x = 0, y = 25, w = 1440, h = 875 } end,
  absoluteToLocal = function(_, r) return r end,
  snapshot = function(_, r) return { area = r } end,
}
local janWin = { snapshot = function() return "jan picture" end }
hs = {
  keycodes = { map = { rightcmd = 54 } },
  settings = { get = function(k) return settings[k] end, set = function(k, v) settings[k] = v end },
  screen = { mainScreen = function() return screen end },
  mouse = { absolutePosition = function() return pointer end, getCurrentScreen = function() return screen end },
  canvas = { new = newCanvas, windowLevels = { floating = 3 } },
  timer = {
    secondsSinceEpoch = function() return now end,
    doAfter = function(_, fn) later[#later + 1] = fn end,
    doEvery = function(_, fn) return timer(fn) end,
  },
  alert = { show = function(m) alerts[#alerts + 1] = m end },
  eventtap = {
    new = function(_, fn) return { fn = fn, start = function() end } end,
    checkMouseButtons = function() return buttons end,
  },
}
print = function() end
local start = assert(source:find("-- Second window: a live copy of Jan", 1, true))
local finish = assert(source:find("mirrorTap:start()", start, true))
local block = "local types, TAP_SECONDS, chatWindow = ...\n"
  .. "local function inside(p, r) return p.x >= r.x and p.x < r.x + r.w and p.y >= r.y and p.y < r.y + r.h end\n"
  .. source:sub(start, finish - 1) .. "\nreturn mirrorTap\n"
local tap = assert(load(block))(types, 0.35, function() return janWin end)

local function flags(cmd)
  return { containExactly = function(_, list) return cmd and #list == 1 and list[1] == "cmd" end, cmd = cmd }
end
local function key(code, cmd)
  return { getType = function() return types.flagsChanged end, getKeyCode = function() return code end,
    getFlags = function() return flags(cmd) end }
end
local function tapRightCmd()
  assert(tap.fn(key(54, true)) == false)
  now = now + 0.1
  assert(tap.fn(key(54, false)) == false)
  for _, fn in ipairs(later) do fn() end
  later = {}
end

-- First tap opens the mirror showing Jan, without taking focus
tapRightCmd()
local m = canvases[1]
assert(m and m.shown and m.activates == false)
assert(m[2].image == "jan picture" and m[3].action == "skip")

-- Second tap: the screen around the pointer, the size of the mirror, with a dot at the pointer
tapRightCmd()
assert(m[2].image.area.w == 640 and m[2].image.area.x == 500 - 320)
assert(m[3].action == "fill" and m[3].center.x == 320 and m[3].radius == 5)

-- Small moves inside the view: the picture holds still, only the dot moves
pointer = { x = 560, y = 330 }
timers[1].fn()
assert(m[2].image.area.x == 180 and m[3].center.x == 380)

-- Pointer near the edge: the area stays on the screen
pointer = { x = 10, y = 10 }
timers[1].fn()
assert(m[2].image.area.x == 0 and m[2].image.area.y == 0 and m[3].center.x == 10)

-- Pointer over the mirror itself: the last picture stays
pointer = { x = m.box.x + 5, y = m.box.y + 5 }
local before = m[2].image
timers[1].fn()
assert(m[2].image == before)

-- Third tap: back to Jan
tapRightCmd()
assert(m[2].image == "jan picture")

-- Right Command with another key is not a tap
assert(tap.fn(key(54, true)) == false)
tap.fn({ getType = function() return types.keyDown end })
now = now + 0.1
tap.fn(key(54, false))
assert(#later == 0)

-- Dragging moves it and remembers the place
pointer = { x = 900, y = 100 }
buttons.left = true
m.onMouse(m, "mouseDown", "_canvas_")
pointer = { x = 950, y = 160 }
timers[#timers].fn()
assert(m.box.x == 830 and m.box.y == 125 and m.box.w == 640)
buttons.left = false
timers[#timers].fn()
local moved = settings.janMirrorFrame
assert(moved and moved.x == 830 and moved.y == 125)

-- x closes it; the next tap opens it again, back on Jan and where it was left
m.onMouse(m, "mouseDown", "close")
for _, fn in ipairs(later) do fn() end
later = {}
assert(m.deleted and not timers[1].running)
tapRightCmd()
assert(canvases[2].box == moved and canvases[2][2].image == "jan picture")
assert(#alerts == 0)
print = _G.print
io.write("Mirror passed: opens on Jan, switches to the pointer view, clamps, drags, remembers, closes.\n")
