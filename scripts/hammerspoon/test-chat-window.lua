-- Finding Jan's window: Safari's windows are listed at most every 10 s,
-- since every key and click waits while Safari answers.
local source = SCRIPT_SOURCE
if not source then
  local file = assert(io.open("scripts/hammerspoon/jan-remote.lua", "r"))
  source = file:read("*a")
  file:close()
end
local now, listed, visible = 100, 0, true
local screen = { name = function() return "Studio Display" end }
local win = { isStandard = function() return true end, isVisible = function() return visible end,
  screen = function() return screen end, frame = function() return { x = 0, y = 0, w = 10, h = 10 } end }
local app = { allWindows = function() listed = listed + 1 return visible and { win } or {} end }
hs = {
  timer = { secondsSinceEpoch = function() return now end },
  application = { get = function(name) return name == "Safari" and app or nil end },
  window = { timeout = function() end },
}
local start = assert(source:find("-- The Jan/Safari window that is not on the laptop", 1, true))
local finish = assert(source:find("local function post(px, at)", start, true))
local chatWindow, chatFrame = assert(load("local APPS = { 'Jan', 'Safari' }\n"
  .. source:sub(start, finish - 1) .. "\nreturn chatWindow, chatFrame"))()
assert(chatWindow() == win and listed == 1)
now = now + 5
assert(chatWindow() == win and chatFrame() and listed == 1) -- remembered
now = now + 6
assert(chatWindow() == win and listed == 2) -- looked again after 10 s
visible = false
assert(chatWindow() == nil and listed == 3) -- gone: looked again at once
now = now + 1
assert(chatWindow() == nil and listed == 3) -- not found a moment ago: no new search
now = now + 2
visible = true
assert(chatWindow() == win and listed == 4)
print("Chat window passed: found once, remembered, looked for again when gone.")
