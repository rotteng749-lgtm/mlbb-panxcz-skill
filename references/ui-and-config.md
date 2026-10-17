# UI and configuration

## Theming without losing smoothness

A tool UI is a settings surface that users keep open on a phone. Two lessons:

**Scale everything.** The overlay draws into physical pixels, so raw px sizes
look tiny on a 1440p phone and oversized on a tablet. Compute a scale factor
from screen size and multiply every padding, rounding, font and hit target by
it. Panel *width* scaling alone leaves text and buttons wrong, which is what
makes a layout look broken on other devices.

**Keep the animation system; change only the palette.** A theme is a colour
block applied last in `ApplyTheme()`, overriding a small set of `ImGuiCol_*`
entries plus the rounding/spacing metrics. Animated widgets (switch fill, glow,
section bars) keep working because they read those colours rather than hardcode
them. When porting a theme that wants to zero out the accent, do not take it
literally — the accent is the visual language of every other theme in the tool.

**Gate per-theme behaviour, not per-theme checks.** Feature flags keyed on the
theme index let you restyle a theme without touching its feature code:

```cpp
static bool UiThemeSwitchRows(int t) { return t == 4; }
static bool UiThemeAllowsPolish(int t) { return !(t == 4 || t == 5 || t == 6); }
```

## Custom widgets

If a reference menu has a distinctive widget, port it and fix two things:

1. **Scale it.** A ported widget usually has hardcoded radii and a `GetFrameHeight()`
   frame size — fine at one resolution, visibly small at another.
2. **Bound it.** Check the computed inner size before calling ImGui's render
   helpers (`RenderCheckMark`, `RenderText`). A malformed size doesn't degrade,
   it draws broken rectangles.

Route custom widgets through one dispatcher so a theme can swap them without
touching call sites:

```cpp
namespace ImGui {
inline bool ToolCheckbox(const char* l, bool* v) {
    if (UiThemeMono(theme)) return MonoCheck(l, v);
    if (UiThemeSwitchRows(theme)) return SwitchStyled(l, v);
    return Checkbox(l, v);
}
}
#define Checkbox(label, v) ToolCheckbox(label, v)
```

`IMGUI_DEFINE_MATH_OPERATORS` is usually **not** defined in game overlays, so
`ImVec2 + ImVec2` does not compile. Write component arithmetic explicitly; do
not turn the macro on for one widget and pull it into every include.

## Configuration file

Plain `key=value` in `/data/local/tmp`. Rules:

- **Clamp on load, always.** A stale config from another phone carries values
  that are nonsense here; clamp each to its UI range instead of trusting it.
- **Respect a "0 means unlimited" sentinel.** If the UI allows 0 = off, the
  loader's lower clamp must be 0. Clamping to 1 makes the option unreachable —
  a bug that looks like "the setting does nothing".
- **Deleted features must lose their config keys too.** Leave a key in the
  loader and an old config can re-enable behaviour that has no UI switch left.
  A feature with no off switch is worse than a missing feature.
- Autosave on a timer plus on change, so a kill doesn't lose settings.

## Feature removal

When removing a feature, remove: the UI, the toggle global, the engine path,
**and the config key**. Verify no leftover write path by grepping the removed
symbol; if the name still appears in a tick, the feature is merely invisible,
not gone.

Move survivors to a new tab rather than deleting the tab wholesale — users
lose the calibrations and settings that lived in it.