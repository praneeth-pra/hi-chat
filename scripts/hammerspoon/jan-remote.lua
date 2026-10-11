-- Jan remote for Hammerspoon: scroll the chat and dictate
-- Smoothly scrolls the Jan chat window on your external monitor from the
-- keyboard, without moving your mouse there.
--
--   hold fn + two-finger scroll  scrolls Jan instead of the laptop screen,
--                                with the trackpad's normal feel and glide
--   fn + Up / Down          jump to the code block above / below in Jan;
--                           press again to keep stepping through the code
--   fn + Shift + Down / Up  scroll fast (tap for a glide, hold to keep going)
--   Z                       jump to Jan: pointer and cursor go into the prompt box
--   X                       jump back: the pointer returns to where it was last
--                           seen off Jan, and the window there gets focus
--                           (Z and X work independently)
--   fn + Return             send in Jan without leaving the app you're in:
--                           what's typed in the prompt box
--   tap Left Control        dictate in Jan: starts recording your mic; tap
--                           again to stop, transcribe and send it. Control held with
--                           another key or a click works as usual.
--
-- On a Mac keyboard fn + Up / Down are Page Up / Page Down, so while
-- Hammerspoon runs, those keys no longer reach other apps. Left / Right
-- arrows and fn + Left / Right remain available to the app in front.
--
-- Settings you may want to change:
local SPEED = 700        -- pixels per second while held
local TAP = 120          -- pixels a quick tap scrolls
local FAST_SPEED = 2000  -- with Shift
local FAST_TAP = 600     -- with Shift
local WARP = false       -- true if scrolling does nothing: the pointer then
                         -- jumps to the chat and back (may flicker)
local FLIP = false       -- true if Down scrolls up on your Mac

local FRAME = 1 / 60
local MAX_SECONDS = 8    -- safety stop if a key release is missed

-- Jan as a Safari web app ("Add to Dock") is its own app named "Jan";
-- otherwise it is a Safari window.
local APPS = { "Jan", "Safari" }

-- The Jan/Safari window that is not on the laptop's built-in screen
local function chatWindow()
  local fallback
  for _, name in ipairs(APPS) do
    local app = hs.application.get(name)
    if app then
      for _, win in ipairs(app:allWindows()) do
        if win:isStandard() and win:isVisible() then
          local screen = win:screen()
          local screenName = screen and screen:name() or ""
          if not screenName:find("Built%-in") then return win end
          fallback = fallback or win
        end
      end
    end
  end
  return fallback
end

local function post(px, at)
  if FLIP then px = -px end
  local event = hs.eventtap.event.newScrollEvent({ 0, px }, {}, "pixel")
  if WARP then
    local back = hs.mouse.absolutePosition()
    hs.mouse.absolutePosition(at)
    event:post()
    hs.mouse.absolutePosition(back)
  else
    event:location(at)
    event:post()
  end
end

-- The scroll in progress: runs every frame until the key is released and
-- at least a tap's distance has been covered.
local active

local function stop(s)
  s.timer:stop()
  if active == s then active = nil end
end

local function start(dir, speed, tap)
  if active then stop(active) end
  local win = chatWindow()
  if not win then
    hs.alert.show("Jan window not found")
    return
  end
  local f = win:frame()
  local at = { x = f.x + f.w / 2, y = f.y + f.h / 2 }
  local s = { moved = 0, carry = 0, released = false, frames = 0 }
  s.timer = hs.timer.doEvery(FRAME, function()
    local want = speed * FRAME + s.carry
    local px = math.floor(want)
    s.carry = want - px
    if px > 0 then
      post(dir * px, at)
      s.moved = s.moved + px
    end
    s.frames = s.frames + 1
    if (s.released and s.moved >= tap) or s.frames * FRAME > MAX_SECONDS then
      stop(s)
    end
  end)
  active = s
end

local function release()
  if active then active.released = true end
end

local function bind(mods, key, dir, speed, tap)
  hs.hotkey.bind(mods, key, function() start(dir, speed, tap) end, release)
end

-- Negative scrolls the page down
bind({ "shift" }, "pagedown", -1, FAST_SPEED, FAST_TAP)
bind({ "shift" }, "pageup", 1, FAST_SPEED, FAST_TAP)

-- Keys for Jan, sent straight to its window without focusing it:
-- Shift + F16 / F17 (code block above / below) and so on, keys a
-- Mac laptop doesn't have.
local function toggle(key, mods)
  local win = chatWindow()
  if not win then
    hs.alert.show("Jan window not found")
    return
  end
  hs.eventtap.keyStroke(mods or {}, key, 20000, win:application())
end

-- fn + Up / Down: the code block above / below
hs.hotkey.bind({}, "pageup", function() toggle("f16", { "shift" }) end)
hs.hotkey.bind({}, "pagedown", function() toggle("f17", { "shift" }) end)

-- fn + Return: sends F15 to Jan, the same way as the toggles. Jan sends the
-- typed text in the prompt box. The key
-- is swallowed, so the app in front never sees it. Most Macs send fn + Return
-- as the keypad Enter key.
local RETURN, PAD_ENTER = hs.keycodes.map["return"], hs.keycodes.map["padenter"]

-- Global for the same reason as scrollTap below
enterTap = hs.eventtap.new({ hs.eventtap.event.types.keyDown }, function(e)
  local key = e:getKeyCode()
  if not e:getFlags().fn or (key ~= RETURN and key ~= PAD_ENTER) then return false end
  if e:getProperty(hs.eventtap.event.properties.keyboardEventAutorepeat) ~= 0 then return true end
  hs.timer.doAfter(0, function() toggle("f15") end)
  return true
end)
enterTap:start()

-- Left Control on its own, pressed and let go within TAP_SECONDS: sends F14
-- to Jan, which starts dictation, or stops it and sends the text. Control
-- isn't swallowed, so Control + a key or a click still works everywhere.
local LEFT_CTRL = hs.keycodes.map["ctrl"]
local TAP_SECONDS = 0.35
local ctrlDownAt = nil
local types = hs.eventtap.event.types

dictateTap = hs.eventtap.new({ types.flagsChanged, types.keyDown, types.leftMouseDown, types.rightMouseDown, types.scrollWheel }, function(e)
  if e:getType() ~= types.flagsChanged then
    ctrlDownAt = nil -- used with another key or the mouse: not a tap
    return false
  end
  local flags = e:getFlags()
  if e:getKeyCode() == LEFT_CTRL and flags:containExactly({ "ctrl" }) then
    ctrlDownAt = hs.timer.secondsSinceEpoch()
  elseif e:getKeyCode() == LEFT_CTRL and not flags.ctrl and ctrlDownAt then
    if hs.timer.secondsSinceEpoch() - ctrlDownAt < TAP_SECONDS then
      hs.timer.doAfter(0, function() toggle("f14") end)
    end
    ctrlDownAt = nil
  else
    ctrlDownAt = nil -- another modifier joined in
  end
  return false
end)
dictateTap:start()

-- fn + trackpad: while fn is held, scroll gestures are moved to the Jan
-- window. The glide after you lift your fingers follows the same gesture,
-- even if fn is already released.
local MARK = 0x4A414E -- tags our own copies so they aren't caught again
local props = hs.eventtap.event.properties
local redirecting = false
local cached, cachedAt = nil, 0

local function chatCenter()
  if hs.timer.secondsSinceEpoch() - cachedAt > 1 then
    local win = chatWindow()
    cached = nil
    if win then
      local f = win:frame()
      cached = { x = f.x + f.w / 2, y = f.y + f.h / 2 }
    end
    cachedAt = hs.timer.secondsSinceEpoch()
  end
  return cached
end

-- Global on purpose: a local tap would be garbage-collected and stop working
scrollTap = hs.eventtap.new({ hs.eventtap.event.types.scrollWheel }, function(e)
  if e:getProperty(props.eventSourceUserData) == MARK then return false end
  local momentum = e:getProperty(props.scrollWheelEventMomentumPhase)
  if e:getFlags().fn then
    redirecting = true
  elseif momentum == 0 then
    redirecting = false
  end
  if not redirecting then return false end
  local at = chatCenter()
  if not at then return false end
  -- A fresh event, not a copy of the trackpad's: a copy can carry the
  -- pointer to the monitor with it. Same distance, phase and glide.
  local dy = e:getProperty(props.scrollWheelEventPointDeltaAxis1)
  local dx = e:getProperty(props.scrollWheelEventPointDeltaAxis2)
  if FLIP then dy = -dy end
  local ev = hs.eventtap.event.newScrollEvent({ dx, dy }, {}, "pixel")
  ev:setProperty(props.scrollWheelEventIsContinuous, 1)
  ev:setProperty(props.scrollWheelEventScrollPhase,
    e:getProperty(props.scrollWheelEventScrollPhase))
  ev:setProperty(props.scrollWheelEventMomentumPhase, momentum)
  ev:setProperty(props.eventSourceUserData, MARK)
  ev:location(at)
  return true, { ev }
end)
scrollTap:start()

-- Z / X: jump to Jan's prompt box and back. While Hammerspoon runs, the
-- z and x keys no longer type letters (Shift + Z / X still type capitals).
local Z, X = hs.keycodes.map.z, hs.keycodes.map.x
local lastOnLaptop -- where the pointer was last seen off Jan (kept up to date below)

local function inside(point, rect)
  return point.x >= rect.x and point.x < rect.x + rect.w and point.y >= rect.y and point.y < rect.y + rect.h
end

-- Where the prompt box is: Jan has just put the cursor in it (F17), so it is
-- the focused element. Falls back to the bottom middle of the window.
local function promptBoxPoint(win)
  local f = win:frame()
  local ok, el = pcall(function()
    return hs.axuielement.systemWideElement():attributeValue("AXFocusedUIElement")
  end)
  if ok and el then
    local r = el:attributeValue("AXFrame")
    if r and r.w and r.w > 0 and inside({ x = r.x + 1, y = r.y + 1 }, f) then
      return { x = r.x + math.min(r.w / 2, 200), y = r.y + r.h / 2 }, "prompt box"
    end
  end
  return { x = f.x + f.w / 2, y = f.y + f.h - 80 }, "bottom of window (prompt box not found)"
end

-- How the pointer moves: GLIDE = 0 makes it vanish here and appear there in
-- one step, with nothing drawn in between (keep it 0: the laptop screen is shared)
local GLIDE = 0
local glideTimer
local function glide(to, done)
  if glideTimer then glideTimer:stop() glideTimer = nil end
  local from = hs.mouse.absolutePosition()
  local steps = math.max(1, math.floor(GLIDE * 60))
  local i = 0
  local function step()
    i = i + 1
    local t = i / steps
    local e = 1 - (1 - t) ^ 3 -- ease out: fast start, soft landing
    hs.mouse.absolutePosition({ x = from.x + (to.x - from.x) * e, y = from.y + (to.y - from.y) * e })
    if i >= steps then
      if glideTimer then glideTimer:stop() glideTimer = nil end
      if done then done() end
      return true
    end
  end
  if steps <= 1 then step() return end
  glideTimer = hs.timer.doEvery(1 / 60, step)
end

-- Dummy cursor: while the real pointer is over on Jan, a look-alike arrow stays
-- where it was on the laptop screen, so the shared screen still shows a cursor.
-- Set DUMMY_CURSOR = false to turn it off.
local DUMMY_CURSOR = true
local cursorScale = 1
do -- Accessibility scaling is in screen points, independent of Retina pixels.
  local out = hs.execute("defaults read com.apple.universalaccess mouseDriverCursorSize 2>/dev/null")
  cursorScale = math.max(1, tonumber(out) or 1)
end
local dummy -- the canvas, while it is showing
local cursorImage, cursorInfo
-- Read the native arrow once. Keep its logical size and hotspot; do not stretch
-- a hand-drawn polygon or add a second outline/shadow to the system artwork.
do
  local path = os.tmpname() .. ".tiff"
  local ok, result = hs.osascript.javascript(string.format([[
    ObjC.import('AppKit');
    const cursor = $.NSCursor.arrowCursor;
    const image = cursor.image;
    const size = image.size;
    const hotspot = cursor.hotSpot;
    if (!image.TIFFRepresentation.writeToFileAtomically(%q, true))
      throw new Error('Could not export native cursor');
    JSON.stringify({w: size.width, h: size.height, x: hotspot.x, y: hotspot.y});
  ]], path))
  if ok and type(result) == "string" then
    local decoded, info = pcall(hs.json.decode, result)
    if decoded and type(info) == "table" and tonumber(info.w) and tonumber(info.h)
      and tonumber(info.x) and tonumber(info.y) and info.w > 0 and info.h > 0 then
      cursorImage = hs.image.imageFromPath(path)
      if cursorImage then cursorInfo = info end
    end
  end
  os.remove(path)
  if not cursorImage then
    hs.printf("Jan remote: native cursor unavailable; dummy cursor disabled.")
  end
end

local function hideDummy()
  if dummy then dummy:delete() dummy = nil end
end

local function showDummy(at)
  hideDummy()
  if not DUMMY_CURSOR or not cursorImage then return end
  local k = cursorScale
  dummy = hs.canvas.new({
    x = at.x - cursorInfo.x * k, y = at.y - cursorInfo.y * k,
    w = cursorInfo.w * k, h = cursorInfo.h * k,
  })
  dummy:appendElements({
    type = "image", image = cursorImage,
    imageScaling = "scaleToFit", imageAlignment = "center",
    frame = { x = 0, y = 0, w = cursorInfo.w * k, h = cursorInfo.h * k },
  })
  dummy:level(hs.canvas.windowLevels.cursor or hs.canvas.windowLevels.overlay)
  dummy:behavior({ "canJoinAllSpaces", "stationary" })
  dummy:show()
end

local lastBox -- where the prompt box was last time, so Z can head straight there

local function jumpToJan()
  local win = chatWindow()
  if not win then
    print("[jan jump] Z: no Jan window found (is the Jan app open?)")
    hs.alert.show("Jan window not found")
    return
  end
  local here = hs.mouse.absolutePosition()
  local f = win:frame()
  if not inside(here, f) then showDummy(here) end
  local guess = (lastBox and inside(lastBox, f)) and lastBox or { x = f.x + f.w / 2, y = f.y + f.h - 80 }
  -- Start moving at once; focus and the prompt box happen while it glides
  local app = win:application()
  app:activate(true) -- bring all of Jan's windows forward
  win:raise()
  win:focus()
  -- F17 once Jan is active: Jan puts the cursor in the prompt box
  hs.timer.doAfter(0.08, function() hs.eventtap.keyStroke({}, "f17", 20000) end)
  glide(guess, function() hs.timer.doAfter(0.05, function()
    local target, found = promptBoxPoint(win)
    print("[jan jump] Z: from", here.x, here.y, "to", target.x, target.y, found, "front:",
      hs.application.frontmostApplication():name())
    if found == "prompt box" then lastBox = target end
    local front = hs.application.frontmostApplication()
    local settle = function()
      -- Only click if Jan still isn't the active app
      if front ~= win:application() then hs.eventtap.leftClick(target) end
    end
    if math.abs(target.x - guess.x) + math.abs(target.y - guess.y) > 4 then
      glide(target, settle)
    else
      settle()
    end
  end) end)
end

-- Keep track of where the pointer was last seen off Jan, so X works on its
-- own, whether or not Z was used
pointerWatch = hs.timer.doEvery(0.2, function()
  if glideTimer then return end -- ignore the pointer mid-glide
  local here = hs.mouse.absolutePosition()
  local win = chatWindow()
  if not (win and inside(here, win:frame())) then
    lastOnLaptop = here
    hideDummy() -- the real pointer is back, so the stand-in goes
  end
end)

local function jumpBack()
  local here = hs.mouse.absolutePosition()
  local back = lastOnLaptop
  if not back then
    local laptop = hs.screen.primaryScreen()
    for _, sc in ipairs(hs.screen.allScreens()) do
      if sc:name():find("Built%-in") then laptop = sc end
    end
    local f = laptop:frame()
    back = { x = f.x + f.w / 2, y = f.y + f.h / 2 }
  end
  print("[jan jump] X: at", here.x, here.y, "back to", back.x, back.y)
  glide(back)
  hideDummy()
  -- Give focus to the window under that spot
  for _, w in ipairs(hs.window.orderedWindows()) do
    if inside(back, w:frame()) then w:focus() break end
  end
end

-- Global for the same reason as scrollTap
jumpTap = hs.eventtap.new({ hs.eventtap.event.types.keyDown }, function(e)
  local flags = e:getFlags()
  if flags.fn or flags.cmd or flags.ctrl or flags.alt or flags.shift then return false end
  -- Holding the key down repeats it; only the first press counts
  if e:getProperty(hs.eventtap.event.properties.keyboardEventAutorepeat) ~= 0 then
    local k = e:getKeyCode()
    return k == Z or k == X
  end
  local key = e:getKeyCode()
  -- Window and focus changes run just after this key is swallowed; done
  -- inside it, macOS can ignore them
  if key == Z then
    hs.timer.doAfter(0, jumpToJan)
    return true
  elseif key == X then
    hs.timer.doAfter(0, jumpBack)
    return true
  end
  return false
end)
jumpTap:start()

-- macOS switches a listener off if it ever answers too slowly; switch it
-- back on so fn + scroll keeps working
tapWatchdog = hs.timer.doEvery(2, function()
  for _, tap in ipairs({ scrollTap, jumpTap, enterTap, dictateTap }) do
    if not tap:isEnabled() then
      print("[jan] a listener was switched off by macOS, restarting it")
      tap:start()
    end
  end
end)

hs.alert.show("Jan scroller ready")
