-- Portable callback checks; native Safari/CGEvent behavior requires a Mac.
local source = SCRIPT_SOURCE
if not source then
  local file = assert(io.open("scripts/hammerspoon/jan-remote.lua", "r"))
  source = file:read("*a")
  file:close()
end
local now, callback, posted, alerts = 1, nil, {}, {}
local keymap = { alt = 58, escape = 53, tab = 48, a = 0, c = 8, v = 9,
  x = 7, z = 6, pageup = 116, pagedown = 121, home = 115, ["end"] = 119,
  delete = 51, forwarddelete = 117, left = 123, right = 124, up = 126, down = 125 }
for i = 1, 20 do keymap["f" .. i] = 200 + i end
local types = { flagsChanged = 1, keyDown = 2, keyUp = 3, leftMouseDown = 4,
  rightMouseDown = 5, scrollWheel = 6 }
local app, win = {}, {}
local title, available = "Hi-chat — Safari", true
app.focusedWindow = function() return available and win end
app.mainWindow = app.focusedWindow
app.name = function() return "Safari" end
app.activate = function() error("Must not activate Safari") end
win.id = function() return 10 end
win.title = function() return title end
win.isStandard = function() return true end
win.isVisible = function() return available end
win.focus = function() error("Must not focus the window") end
local function flags(values)
  local result = values or {}
  result.containExactly = function(self, names)
    local expected = {}
    for _, name in ipairs(names) do expected[name] = true end
    for _, name in ipairs({ "alt", "cmd", "ctrl", "shift", "fn" }) do
      if not not self[name] ~= not not expected[name] then return false end
    end
    return true
  end
  return result
end
local function event(kind, key, values, chars, marker)
  local e = { kind = kind, key = key, flags = flags(values), chars = chars,
    marker = marker }
  e.getType = function(self) return self.kind end
  e.getKeyCode = function(self) return self.key end
  e.getFlags = function(self) return self.flags end
  e.getCharacters = function(self) return self.chars end
  e.getProperty = function(self) return self.marker or 0 end
  e.setProperty = function(self, _, value) self.marker = value; return self end
  e.setFlags = function(self, value) self.flags = value; return self end
  e.copy = function(self) return event(self.kind, self.key, self.flags, self.chars, self.marker) end
  e.post = function(self, target)
    assert(target == app, "Every event must target Safari, not the active app")
    posted[#posted + 1] = self
  end
  return e
end
hs = {
  keycodes = { map = keymap },
  application = { get = function(name) return name == "Safari" and app or nil end },
  alert = { show = function(message) alerts[#alerts + 1] = message end },
  timer = { secondsSinceEpoch = function() return now end,
    doAfter = function(_, fn) fn() end },
  eventtap = { event = { types = types, properties = { eventSourceUserData = 1 },
    newKeyEvent = function(_, key, down)
      return event(down and types.keyDown or types.keyUp, keymap[key], {})
    end } },
}
local start = assert(source:find('-- Background typing:', 1, true))
local finish = assert(source:find('-- fn + trackpad:', start, true))
local jumpStart = assert(source:find('-- Global for the same reason as scrollTap\njumpTap', 1, true))
local jumpEnd = assert(source:find('-- macOS switches a listener off', jumpStart, true))
local block = 'local APPS,TAP_SECONDS,types,RETURN,PAD_ENTER = ...\n'
  .. source:sub(start, finish - 1)
  .. '\nlocal Z,X=6,7\nlocal props=hs.eventtap.event.properties\n'
  .. 'local function jumpToJan() error("Must not jump while typing") end\n'
  .. 'local function jumpBack() error("Must not jump while typing") end\n'
  .. source:sub(jumpStart, jumpEnd - 1)
  .. '\nreturn function() return typingTarget end, toggleTyping, typingTap, jumpTap\n'
-- Keep both event tap callbacks so Z/X interception can be checked separately.
local callbacks = {}
hs.eventtap.new = function(_, fn)
  callbacks[#callbacks + 1] = fn
  return { start = function() end }
end
local state, toggle = assert(load(block))({ "Jan", "Safari" }, 0.35, types, 36, 76)
callback = callbacks[1]
local jump = callbacks[2]
local function tapOption()
  callback(event(types.flagsChanged, 58, { alt = true }))
  now = now + 0.1
  callback(event(types.flagsChanged, 58, {}))
end
assert(callback(event(types.keyDown, 0, {}, "a")) == false)
tapOption()
assert(state() and #posted == 4)
assert(posted[1].key == keymap.f17 and posted[3].key == keymap.f18)
assert(posted[1].marker ~= 0)
posted = {}
local a = event(types.keyDown, 0, {}, "a")
assert(callback(a) == true and #posted == 1)
assert(posted[1].chars == "a" and posted[1].marker ~= 0)
assert(callback(posted[1]) == false and #posted == 1) -- no forwarding loop
assert(callback(event(types.keyUp, 0, {})) == true and #posted == 2)
for _, key in ipairs({ keymap.z, keymap.x }) do
  assert(jump(event(types.keyDown, key, {}, "letter")) == false)
  assert(callback(event(types.keyDown, key, {}, "letter")) == true)
  callback(event(types.keyUp, key, {}))
end
assert(callback(event(types.keyDown, 36, {}, "\r")) == true)
assert(posted[#posted].flags.shift == true) -- newline, not auto-send
callback(event(types.keyUp, 36, {}))
assert(callback(event(types.keyDown, 36, { fn = true }, "\r")) == false)
assert(callback(event(types.keyDown, keymap.pageup, {}, "")) == false)
assert(callback(event(types.keyDown, keymap.v, { cmd = true }, "v")) == true)
callback(event(types.keyUp, keymap.v, { cmd = true }))
-- A key released after disabling still goes to the app that got its keydown.
callback(event(types.keyDown, 0, {}, "a"))
tapOption()
assert(not state())
assert(callback(event(types.keyUp, 0, {})) == true)
assert(posted[#posted - 1].key == keymap.f19)
-- Held Option and Option chords must never toggle the mode.
callback(event(types.flagsChanged, 58, { alt = true }))
now = now + 1
callback(event(types.flagsChanged, 58, {}))
assert(not state())
callback(event(types.flagsChanged, 58, { alt = true }))
callback(event(types.keyDown, 0, { alt = true }, "å"))
callback(event(types.flagsChanged, 58, {}))
assert(not state())
tapOption()
assert(callback(event(types.keyDown, keymap.escape, {}, "")) == true and not state())
tapOption()
assert(callback(event(types.keyDown, keymap.tab, { cmd = true }, "")) == false and not state())
tapOption()
title = "Unrelated Safari tab"
assert(callback(event(types.keyDown, 0, {}, "a")) == true and not state())
local count = #posted
toggle()
assert(not state() and #posted == count) -- no text goes to an unrelated tab
title = "Sign in to Hi-chat"
toggle()
assert(not state() and #posted == count)
title = "Hi-chat"
available = false
toggle()
assert(not state())
print('Background typing passed: Option toggle, target pinning, no activation, edits, keyups, escape and shortcuts.')
