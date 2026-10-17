-- Portable checks for Option typing's pointer, clicks and scrolling; native
-- Safari behaviour still needs a Mac.
local source = SCRIPT_SOURCE
if not source then
  local file = assert(io.open("scripts/hammerspoon/jan-remote.lua", "r"))
  source = file:read("*a")
  file:close()
end
local types = { leftMouseDown = 1, leftMouseUp = 2, leftMouseDragged = 3,
  rightMouseDown = 4, rightMouseUp = 5, otherMouseDown = 6, otherMouseUp = 7, mouseMoved = 8 }
local frame = { x = 2000, y = 0, w = 1000, h = 800 }
local app = { activate = function() error("Must not activate Safari") end }
local win = { frame = function() return frame end,
  focus = function() error("Must not focus the window") end }
local pointer, posted, dummy, stopped, signals, moves = { x = 100, y = 100 }, {}, nil, nil, {}, {}
local function event(kind, at, marker)
  local e = { kind = kind, at = at, marker = marker or 0 }
  e.getType = function(self) return self.kind end
  e.location = function(self) return self.at end
  e.getProperty = function(self) return self.marker end
  e.setProperty = function(self, _, value) self.marker = value return self end
  e.copy = function(self) return event(self.kind, self.at, self.marker) end
  e.post = function(self, target)
    assert(target == app, "Clicks must go to Safari, not the active app")
    posted[#posted + 1] = self
  end
  return e
end
local tapFn
hs = {
  mouse = { absolutePosition = function(to) if to then pointer = to end return pointer end },
  eventtap = { new = function(_, fn) tapFn = fn return { start = function() end } end,
    event = { newMouseEvent = function(kind, at)
      local e = event(kind, at)
      e.post = function(self, target)
        assert(target == nil and self.marker ~= 0)
        moves[#moves + 1] = self
      end
      return e
    end } },
}
local start = assert(source:find("-- Background typing takes the pointer along", 1, true))
local finish = assert(source:find("-- Keep track of where the pointer was last seen off Jan", start, true))
print = function() end
local block = "local types, typingProps, TYPING_MARK, getTarget, stopTyping, showDummy, hideDummy, chatWindow, typingSignal, chatFrame = ...\n"
  .. "local typingPointerOn, typingPointerOff, lastBox\n"
  .. "local function inside(p, r) return p.x >= r.x and p.x < r.x + r.w and p.y >= r.y and p.y < r.y + r.h end\n"
  .. source:sub(start, finish - 1):gsub("typingTarget", "getTarget()")
  .. "\nreturn typingPointerOn, typingPointerOff\n"
local target
local on, off = assert(load(block))(types, { eventSourceUserData = 1 }, 0x4A545950,
  function() return target end, function(m) stopped = m end,
  function(at) dummy = at end, function() dummy = nil end, function() return win end,
  function(_, key, mods) signals[#signals + 1] = { key = key, mods = mods } end,
  function() return frame end)

-- Not typing: clicks are left alone
assert(tapFn(event(types.leftMouseDown, { x = 2500, y = 400 })) == false and #posted == 0)

-- Typing on: the pointer moves onto Jan and a dummy keeps its place
target = { app = app, win = win }
on(target)
assert(dummy and dummy.x == 100 and pointer.x == 2500 and pointer.y == 720)

-- A press over Jan becomes Shift + F20, the drag plain moves Safari can follow,
-- and the release Shift + F18; the real click is swallowed
assert(tapFn(event(types.leftMouseDown, { x = 2500, y = 400 })) == true)
assert(tapFn(event(types.leftMouseDragged, { x = 2600, y = 400 })) == true)
assert(#moves == 1 and moves[1].kind == types.mouseMoved and moves[1].at.x == 2600)
assert(tapFn(event(types.leftMouseUp, { x = 2600, y = 400 })) == true)
assert(#signals == 2 and signals[1].key == "f20" and signals[1].mods[1] == "shift")
assert(signals[2].key == "f19" and signals[2].mods[1] == "shift")

-- Typing turned off mid-press: the release still reaches Jan, so no press is left stuck
assert(tapFn(event(types.leftMouseDown, { x = 2500, y = 400 })) == true)
target = nil
assert(tapFn(event(types.leftMouseUp, { x = 2500, y = 400 })) == true)
assert(#signals == 4 and signals[4].key == "f19" and signals[4].mods[1] == "shift")
target = { app = app, win = win }
signals = {}

-- Clicks elsewhere still reach the app under them
assert(tapFn(event(types.leftMouseDown, { x = 100, y = 100 })) == false)
assert(tapFn(event(types.leftMouseUp, { x = 100, y = 100 })) == false)

-- A right click over Jan does nothing, and its release is swallowed too
assert(tapFn(event(types.rightMouseDown, { x = 2500, y = 400 })) == true)
target = nil
assert(tapFn(event(types.rightMouseUp, { x = 2500, y = 400 })) == true)
assert(#signals == 0)
target = { app = app, win = win }

-- Typing off: the pointer comes back and the dummy goes
target = nil
off()
assert(dummy == nil and pointer.x == 100 and pointer.y == 100)

-- Moved back by hand first: it stays where it was put
target = { app = app, win = win }
on(target)
pointer = { x = 300, y = 300 }
off()
assert(pointer.x == 300 and dummy == nil)

-- Scrolling follows Option typing like it follows fn
assert(source:find("if e:getFlags().fn or typingTarget then", 1, true))
assert(stopped == nil)
print("Typing pointer passed: pointer moves to Jan and back, clicks become Shift + F20 for Jan, scrolling follows.")
