# WebKit Iframe Loading Issue

## Problem

In production builds of the Tauri desktop app, iframes displaying app widgets do not visually render their content on initial load. The iframe content loads (network requests complete, `onLoad` fires), but WebKit defers **painting** the content until a user interaction occurs.

### Symptoms

- Widget cards show perpetual loading spinners on app launch
- Clicking ANY app (or any interactive element) causes ALL iframes to suddenly paint
- Manual keyboard shortcuts that toggle UI state also trigger painting
- Issue does NOT occur in development mode (`pnpm tauri dev`)
- Issue ONLY occurs in production builds (`pnpm tauri build`)

### Root Cause

**WebKit User Activation**: WebKit (Safari's rendering engine, used by Tauri's WebView on macOS) has security and performance optimizations that defer or skip certain rendering operations for iframes until there's been a "user activation" - a real user gesture like click, keypress, or touch.

This is NOT the same as content loading. The iframe content fully loads (verified via `onLoad` event), but WebKit's compositor delays painting the iframe content until user interaction.

## What We Tried (Failed Attempts)

### 1. Removing Overlay Elements

**Hypothesis**: A transparent `<div>` overlay on top of the iframe was preventing WebKit from painting.

**Change**: Removed the invisible click overlay, added `pointer-events-none` to iframe.

**Result**: Did not work.

### 2. GPU Compositing Layer

**Hypothesis**: WebKit defers painting for elements with `opacity` transitions. Forcing a GPU layer might help.

**Change**: Added `transform: translateZ(0)` to iframe, removed `transition-opacity`.

**Result**: Did not work.

### 3. Removing opacity:0 During Loading

**Hypothesis**: WebKit explicitly skips painting for `opacity: 0` elements.

**Change**: Made iframe always `opacity: 100`, placed a loading overlay on TOP of the iframe instead.

**Result**: Did not work.

### 4. Forced Component Remount

**Hypothesis**: Toggling debug mode (which unmounts/remounts components) seemed to fix it, so forcing a remount via React key might work.

**Change**: Added a `mountKey` state that increments after 100ms, forcing `WidgetCard` components to remount.

**Result**: Did not work. Programmatic state changes don't provide user activation.

### 5. Programmatic Mode Toggle

**Hypothesis**: If manual debug toggle works, maybe programmatically toggling modes would work.

**Change**: On mount, programmatically switch to debug mode then back to normal mode via `setTimeout`.

**Result**: Did not work. `setTimeout` callbacks are not considered user gestures by WebKit.

## What Worked

### User Gesture Requirement

The key insight: **Any programmatic action (setTimeout, useEffect, state changes) does NOT count as a user gesture.** Only real user interactions (click, keypress, touch) trigger WebKit's "user activation" state.

### Solution: Unified Onboarding Flow on Launch

Instead of auto-loading the main app view, we now show an **Onboarding** screen on app launch that requires user interaction:

1. **Step 1: Workspace Selection** (always shown)
   - Select existing workspace OR create a new one
   - Includes Terms/Privacy clickwrap text
2. **Step 2: API Key Setup** (only if needed)
   - Shown if `health.status === 'no-keys'`
   - Same flow as the old onboarding dialog

```tsx
// In App.tsx
const [hasCompletedOnboarding, setHasCompletedOnboarding] = useState(false)

// Show onboarding until complete
if (!isLoadingWorkspaces && !hasCompletedOnboarding && workspaces.length > 0) {
  return (
    <Onboarding
      workspaces={workspaces}
      health={health}
      onComplete={handleOnboardingComplete}
      onCreateWorkspace={createWorkspace}
      onHealthRetry={checkHealth}
    />
  )
}
```

This provides:

1. **User gesture**: Clicking a workspace button is a real user interaction
2. **Natural UX**: Selecting a workspace is a meaningful action, not a "click to continue" hack
3. **Legal compliance**: Opportunity to show Terms/Privacy clickwrap text
4. **Unified experience**: API key setup flows naturally after workspace selection

### Why This Works

1. User launches app → Onboarding renders (no iframes yet)
2. User clicks a workspace button → This is a **user gesture**
3. WebKit registers user activation for the window
4. If API key needed, user enters it (another user gesture)
5. Main app UI renders with iframes
6. Iframes paint immediately because window now has user activation

## Files Changed

- `desktop/src/components/onboarding.tsx` - Unified onboarding flow (workspace selection + optional API key setup)
- `desktop/src/components/canvas.tsx` - Cleaned up (removed debug code)
- `desktop/src/app.tsx` - Added `hasCompletedOnboarding` state, shows onboarding before main UI
- Deleted: `desktop/src/components/workspace-picker.tsx` (merged into onboarding.tsx)
- Deleted: `desktop/src/components/onboarding-dialog.tsx` (merged into onboarding.tsx)

## Technical Notes

### WebKit User Activation

WebKit tracks "user activation" at the browsing context level. Certain operations require user activation:

- Autoplay of media
- Opening popups
- Clipboard access
- Fullscreen requests
- **Iframe painting optimizations** (our case)

User activation is granted by:

- Click events
- Keyboard events
- Touch events

User activation is NOT granted by:

- `setTimeout`/`setInterval` callbacks
- Promise resolutions
- `useEffect` hooks
- Programmatic state changes

### Development vs Production

The issue doesn't occur in development because:

- Vite's dev server may use different security contexts
- Hot module replacement triggers different rendering paths
- Debug tools may affect WebKit's optimization decisions

### Alternative Solutions Considered

1. **Tauri-side activation**: Inject a synthetic click from Rust when window opens. Not pursued due to complexity.
2. **Invisible activation**: Auto-click a hidden button on load. Doesn't work - needs real user gesture.
3. **Click-anywhere activation**: Show widgets with loading state, first click anywhere activates. Poor UX - widgets appear broken until clicked.

## References

- [WebKit User Activation](https://webkit.org/blog/7753/updates-to-autoplay-policies-on-macos/)
- [User Activation API](https://developer.mozilla.org/en-US/docs/Web/API/UserActivation)
- [Tauri WebView](https://tauri.app/v1/guides/webview-versions/)
