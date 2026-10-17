# Offsets & runtime heal

Everything in this file exists because the naive version fails silently. A
wrong offset does not crash — it reads a neighbouring field, and the feature
shows plausible garbage.

## Why hardcoded offsets break

Mobile Legends ships `libcsharp.so` / `liblogic.so` in `/data/data/<pkg>/app_libs/`,
downloaded separately from the APK. A patch can rewrite them **without bumping
the APK version**. Observed on the same app version:

| Class | Shift |
|---|---|
| `ShowEntity` (Hp, ID, position, death, camp) | **−0x8** (US build) |
| `ShowPlayer` (hero name, kills, room id) | varies per build |
| `RoomData`, `ChooseHeroMgr`, camera | usually stable |

So: one table, healed at runtime, never literals in feature code.

## The offset table

```cpp
// One entry per field. Feature code NEVER writes `+ 0x1a4`.
inline uintptr_t SE_M_HP = 0x1a4;   // ShowEntity.m_Hp
inline uintptr_t SE_M_ID = 0x18c;   // ShowEntity.m_ID (hero/monster id)
inline uintptr_t BM_SHOW_PLAYERS = 0x70;  // BattleManager.m_ShowPlayers

struct T { const char* cls; const char* field; uintptr_t* dst; };
static const T tab[] = {
    { "ShowEntity", "m_Hp",        &SE_M_HP },
    { "ShowEntity", "m_ID",        &SE_M_ID },
    { "BattleManager", "m_ShowPlayers", &BM_SHOW_PLAYERS },
};
```

Note the members are `inline`, not `constexpr`: the healer writes to them at
runtime. `constexpr` here silently defeats the entire mechanism.

## Resolving a class

Two routes, and some classes only have one of them:

1. **Slot cell.** `libbase + slotRva` → `Il2CppClass*`. Works for classes with a
   type-info cell (BattleManager, GameMethod, SystemData, ChooseHeroMgr).
   Slot RVAs come from a dump table *or* from a runtime scan, which must win
   over the table when the scan succeeded.
2. **Live object.** For ShowEntity / ShowPlayer there is no slot. Walk any
   entity list, then `ReadPtr(obj + 0x0)` gives its `Il2CppClass*`. This is how
   heal resolves them.

Field lookup walks `fields[]` entries of stride `0x20`: identifier string at
`+0x08`, offset value at `+0x18`. Follow the parent chain up to ~8 levels,
because much of what you want (`m_Hp`, `m_ID`) is declared on the base class
while the object is a `ShowPlayer`.

## Auto-properties will bite you

```text
[m_EnergyPoint]k__BackingField  @0x1f8
[m_EnergyPointMax]k__BackingField @0x1fc
m_AtkDis                         @0x330
m_transformation                 @0x778
```

The pretty name `m_EnergyPoint` **does not exist** in metadata. Try several
spellings against the same destination — first hit wins:

```cpp
{ "ShowEntity", "m_EnergyPoint",                    &SE_M_ENERGY_POINT },
{ "ShowEntity", "<m_EnergyPoint>k__BackingField",   &SE_M_ENERGY_POINT },
```

## Static fields

Static fields live in a blob at `Il2CppClass + 0xa8`:

```
libbase + slot -> Il2CppClass* -> +0xa8 static_fields -> +fieldOffset
```

The BattleManager *instance* and its *static* blob are different places. A
feature looking for flying skill projectiles must read the static blob
(`m_RunBullets`, a `HashSet<Bullet>`), and a probe that only swept the
instance's list slots will report "that object does not exist" and be wrong.

## Applying the heal safely

Resolve into a pending list first, sanity-check, then apply:

- `off != 0 && off < 0x4000`
- `|off - old| <= 0x2000` (builds shift by tens/hundreds of bytes, not 100 KB)
- Only apply the batch if a healthy fraction resolved (e.g. `>= 20`), otherwise
  the metadata layout is understood wrong and every offset would be replaced
  with garbage.

**Record which offsets actually resolved.** Gates that reject entities (dead
check, ally check, "enemy nearby") must not silently run on an unresolved
offset — in a shifted build they read a neighbour field and return false
forever, which presents as "the feature never fires".

```cpp
std::set<const uintptr_t*> g_healTrusted;
inline bool Trusted(const uintptr_t* dst) {
    return g_healTrusted.count(dst) != 0;
}
```

## Probing live metadata from the command line

Hardcoding guesses is slow; a probe answers in seconds. Ship a CLI mode that
runs **above** the detach step (after attach stdout disappears) and set
`libbase` from `GetBase()` yourself — the global is still 0 in CLI mode:

```bash
PANXCZ_FIELD_PROBE="ShowEntity Energy" ./binary
# [field-probe] ShowEntity slot=0x621c638 klass=0x7127a761e0 cari 'Energy'
# [field-probe]  L0  <m_EnergyPoint>k__BackingField   0x1f8
# [field-probe]  L0  <m_EnergyPointMax>k__BackingField 0x1fc
```

Two traps: `libbase` must be assigned manually, and the class name must be a
plain literal — wrapping it in a string-obfuscation macro makes the macro
parser treat it as an invocation.

## Cheap scanner for hardcoded offsets

Once the table exists, catch new literals automatically:

- match only hex literals (`0xNN`) — matching decimals turns `400.0f` into
  `0x190` and prose into false positives, and a noisy scanner gets ignored
- strip comments and string literals before matching
- report the owning field name when a raw offset collides with a known one
  (`X + 0xd0` where `d0` is `m_EntityCampType` → "read the neighbour field")

This scanner found a real bug that had been shipping: a camp filter reading a
literal, which on a shifted build caused auto-targeting of the user's *own*
team's objective.