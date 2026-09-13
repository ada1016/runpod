# WittleDefender battle-end data and network submission analysis

## Scope and confidence

This report is based on the decompiled `HotFixBattle` source in `wd.zip`, plus the supplied decompilation of `HotFix.NetworkUtils`. It separates three things that are easy to confuse:

1. data accumulated during combat;
2. data captured into the local `LevelEndData` object and its result hash;
3. fields copied into a protobuf request and actually submitted to the server.

The end-request mapping is high confidence where a concrete `NetworkUtils` builder exists. The asynchronous/server-simulated modes are also high confidence as far as the supplied client code goes, but a definitive claim about server-side validation would require server code or observing the complete request/response exchange.

## Executive summary

There are two main battle-end architectures.

### Client-simulated PvE

Most ordinary battles produce and send:

- a `BattleResultDto` containing the level, battle version, result, progress, rewards, selected mode-specific fields, pass time, and a result hash;
- a `Commands` `ByteString` containing the complete recorded command stream, total frame count, and the same result hash;
- `CommonParams` supplied by the general networking layer;
- occasionally an extra outer discriminator such as activity ID or dungeon type.

The server therefore receives much more than a simple “passed” flag. It receives a compact result summary and enough recorded input to replay or validate the deterministic battle.

### Server-simulated/asynchronous PvP

Crusade, cross-arena, guild war, sparring, kungfu, and trade-ship flows do not expose a conventional client `...EndRequest` in the supplied `NetworkUtils`. Their initiating request identifies the opponent/stage and often includes `BattleVersion`; the response supplies the battle result or record. Crusade additionally sends a later `Confirm` boolean. This strongly indicates that these outcomes are generated or adjudicated outside the local end-request pipeline.

## 1. How a local battle ends

`HotFix.Battle.CheckGameEndSystem.OnUpdate` is the common termination detector:

| Condition | Result |
|---|---|
| Quit button set | `BattleEndReason.Quit` |
| Enemy camp loses and no dropped items remain | `BattleEndReason.Sucess` (spelling in binary) |
| Player camp loses | `BattleEndReason.Failed` |
| Time expires | `BattleEndReason.Failed` |

For PvP-mode simulations, both camps are first offered `TryAutoRevive`. Then `AttachEndCommonData` captures:

| Local `LevelEndData` member | Source |
|---|---|
| `IsSuccess`, `EndReason` | constructed from the detected outcome |
| `LevelId`, `MainLevelId` | `StartData` |
| `BattleId` | `StartData.BattleId` |
| `Type` | `StartData.Type` |
| `MaxWave` | current wave; on success normally total wave, and Tower uses current wave + 1 |
| `Rewards` | `Rewards.GetAllItems()` |
| `Statistics` | shared `BattleStatistics` after `CollectBattleEndData()` |
| `RemainingHp` | player camp aggregate remaining HP |
| `PassTime` | current battle time |
| `ElementTowerLayer` | Element Tower mode object, where applicable |
| `PlayEndGameTime` | win/lose presentation delay |

The selected battle mode then gets `OnEndBattle(endData)` and may add mode-specific data.

## 2. Data accumulated during combat

`BattleStatistics` keeps considerably more information in memory than `BuildBattleResult` directly sends.

### Per-unit statistics

Each `HeroStatisticData` can contain:

- `BornTime`;
- `TotalDamage`;
- `TotalHeal`;
- `TotalDef` (damage received/defended accounting);
- `HeroID`;
- `RemainingHPPercentage` (0–100 scale);
- `RemainWeaponEnergyPercent` (0–100 scale);
- per-bullet damage and heal maps.

The local `BattleStatistics` holds player and enemy maps for heroes, mecha, magic stones, and magic arrays, plus maximum damage/heal/defense, camp energy percentages, revive count, total boss HP change, and final boss HP percentage.

At battle end, `CollectBattleEndData` refreshes player hero HP and weapon-energy percentages, does the same for the enemy when the enemy camp is a `PlayerCampData`, records both camps’ mecha energy, and calculates boss HP percentage. Boss HP percent is represented on a 0–10000 scale; hero remaining HP percentages use 0–100.

### Important serialization boundary

`LevelEndData`, `BattleStatistics`, and `HeroStatisticData` carry ordered `JsonProperty` attributes, while several other public fields do not. The decompiler could not decode the argument of `JsonObject`. The layout strongly suggests opt-in JSON serialization, in which case the stable hash covers only the annotated members:

- `LevelEndData`: success, end reason, max wave, level ID, rewards, presentation time, battle ID, type, statistics;
- `BattleStatistics`: player `HeroMap`, `ReviveTimes`, `BossHpChangeAll`, `BossHpPercent`, player `MechaMap`;
- `HeroStatisticData`: born time, damage, healing, defense, hero ID, remaining HP percentage, weapon-energy percentage.

This is a well-supported inference, not fully proven, because the attribute constructor argument was lost in decompilation. Runtime reflection or dumping `GetJsonString()` would settle it conclusively.

## 3. Result hash and replay stream

When `BattleLogicMgr.TryEndData()` runs, `RecorderMgr.EndBattle()` records:

- `FrameTotal = TimeMgr.FrameCount`;
- `EndData = logicMgr.EndData`;
- `ResultHashCode = EndData.GetStabelHash()`.

`GetStabelHash()` serializes `LevelEndData` to JSON, hashes the UTF-8 bytes with SHA-256, and interprets the first four digest bytes as a signed `Int32`. It is a deterministic consistency checksum, not a secure message authentication code: no secret key is involved.

`SerializeReplayCommands()` builds `BattleCommandAll` with:

| Field | Meaning |
|---|---|
| `TotalFrame` | final simulation frame count |
| `ResultHashCode` | hash described above |
| `Commands[]` | every recorded `RecorderMgr.Steps` entry |
| `CommandId` | command enum value, including `ReselectSkill = 4` when actually recorded |
| `FrameId` | frame on which the command occurred |
| `ValueInt` | integer command argument |
| `ValueFp` | fixed-point raw value |
| `ValueIntArray` | optional integer-array argument |

The resulting protobuf is sent as the request’s `Commands` `ByteString`. This method itself performs protobuf serialization only; any later compression, encryption, or framing would occur in the networking layer.

## 4. Exact contents of `BattleResultDto`

`BattleLevelLogic.BuildBattleResult` copies the following fields:

| `BattleResultDto` field | Source / condition |
|---|---|
| `LevelInfo` | assigned by the endpoint builder before `BuildBattleResult` |
| `BattleVersion` | `BattleEnv.BattleVersion` |
| `MaxWave` | `EndData.MaxWave` |
| `EndReason` | success, failed, or quit |
| `BattleRewards[]` | each local reward as `{ ConfigId, Count }` |
| `Statistic.BossHpChangeAll` | always copied |
| `Statistic.PassTime` | always copied |
| `FrameStatistics.ResultHashCode` | recorder hash |
| `PvpStatistics` | only when `NeedBuildPvpStatistics()` is true |
| `SkillUpgradeIds[]` | when the mode supplied them |
| `ConditionChapterStarIndex[]` | Star Challenge finish conditions |
| `StarIndex[]` | Difficult Chapter finish conditions |
| `KongYuStarIndex[]` | Kongyu finish conditions |
| `Statistic.BossHpPercent` | Rogue only |

`BuildBattleResult` does **not directly copy** general hero damage/heal/defense totals, `ReviveTimes`, aggregate `RemainingHp`, `BattleId`, `Type`, `MainLevelId`, `Rank`, element-tower layer, or the specialized `*BattleEndData` members. Some per-hero information may still enter the protobuf through `BuildPvpStatistics` for modes where `NeedBuildPvpStatistics()` is true; its implementation was not present in the supplied decompiled set, so its exact field list remains an unresolved dependency.

## 5. Mode-by-mode submission matrix

### Modes using the standard client result + commands envelope

All entries below send `CommonParams + Result(BattleResultDto) + Commands(BattleCommandAll bytes)` unless the “extra fields” column says otherwise.

| `BattleType` | Battle mode | End request | Extra/result-specific data |
|---|---|---|---|
| `MainLevel` | `MainBattleMode` | `LevelEndRequest` | standard fields |
| `GoldDungeon` | `MainBattleMode` | `GoldExpDungeonEndRequest` | `Type = Gold` |
| `ExpDungeon` | `MainBattleMode` | `GoldExpDungeonEndRequest` | `Type = Exp` |
| `EquipDungeon` | `MainBattleMode` | `EquipDungeonEndRequest` | standard fields |
| `BossDungeon` | `BossBattleModel` | `BossDungeonEndRequest` | boss HP change; other boss result fields depend on result DTO/schema |
| `GuildBoss` | `BossBattleModel` | endpoint naming is not exposed in the supplied `NetworkUtils` extract | local end data is generated; exact outer request remains unproven |
| `CyCleActivityBoss` | `BossBattleModel` | `CycleActivityBossDungeonEndRequest` | `ActivityId` |
| `SeasonBoss` | `BossBattleModel` | `SeasonBossDungeonEndRequest` | `ActId` |
| `Tower` | `TowerBattleMode` | `TowerChallengeEndRequest` | `SkillUpgradeIds`; `TowerRandomCount`; `TowerSkillSelectCount`; special max-wave rule |
| `StarChallenge` | `StarChallengeBattleMode` | `ConditionChapterEndRequest` | successful finish-condition indexes → `ConditionChapterStarIndex` |
| `RuneDungeon` | `RuneDungeonBattleMode` | `RuneDungeonEndRequest` | standard fields |
| `SeasonRune` | `RuneDungeonBattleMode` | `SeasonRuneDungeonEndRequest` | `ActId` |
| `ElementTower` | `ElementTowerBattleMode` | `ElementTowerEndRequest` | local layer is collected, but `BuildBattleResult` does not directly copy it |
| `SeasonElementTower` | `SeasonElementTowerBattleMode` | `SeasonElementTowerEndRequest` | `ActId`; same layer caveat |
| `KongyuDungeon` | `KongyuBattleMode` | `KongYuDungeonEndRequest` | successful conditions → `KongYuStarIndex` |
| `DifficultChapter` | `DifficultChapterBattleMode` | `DifficultChapterEndRequest` | successful conditions → `StarIndex` |
| `CrisisGame` | `CrisisGameBattleMode` | `KActivityCrisisGameEndRequest` | standard result and commands; activity metadata is primarily established at start |
| `Rogue` | `RogueBattleMode` | `RogueEndBattleRequest` | `ActId`, `ClientResult`, `Commands`; result includes `BossHpPercent` |

For Rogue, the request builder accepts an already-created `clientResult` and command bytes rather than constructing them internally, but the transmitted categories are equivalent.

### Modes with no conventional client battle-end payload in the supplied code

| `BattleType` | Observed request | Client-supplied fields | Interpretation |
|---|---|---|---|
| `Crusade` | `CrusadeBattleRequest`; later `CrusadeBattleConfirmRequest` | start: `Level`, `BattleVersion`, `CommonParams`; confirm: `Confirm`, `CommonParams` | no client `BattleResultDto` or replay bytes found; result appears server-produced, then acknowledged |
| `Crossarena` | `CrossArenaChallengeRequest` | opponent `Id`, server battle version, common params | asynchronous/server-resolved challenge |
| `Sparring` | `QieCuoRequest` | opponent user ID, self/opponent activity IDs, common params | no end request found |
| `GuildWar` | `GuildWarBattleRequest` | station ID, attacked user ID, server battle version, common params | response supplies battle result/reward data |
| `Kungfu` | mode uses guild-war/PvP battle machinery | exact request-to-`BattleType` linkage is not fully present in this extract | no standard client end request identified |
| `TradeShip` | `TradeShipGuildRobRequest` or `TradeShipUserRobRequest` | target ship/owner/guild plus battle version and common params | response is converted to `TradeShipBattleInfo`; no client result upload found |
| `TestLevel` | no production end request identified | none proven | likely local/development path |

These modes can still create a local `LevelEndData` while displaying or replaying a server-provided battle. That does not mean the local object is submitted afterward.

## 6. What the server can plausibly validate

For standard client-simulated battles, the request exposes three consistency surfaces:

1. the explicit result summary (`EndReason`, wave, time, rewards, boss values, conditions, selected skills);
2. the deterministic replay command stream and total frame count;
3. the result hash derived from the local end state.

Whether the server fully re-simulates commands, checks only selected fields, or trusts some values cannot be proven from client code. The presence of battle version, frame count, command stream, and result hash is nevertheless strong evidence that replay/consistency validation is supported by the protocol.

For server-simulated PvP modes, the client supplies much less outcome data, so authoritative values likely come from the response rather than a claimed local result.

## 7. Items not proven by this source set

- The exact contents of `CommonParams`.
- The exact fields emitted by `BuildPvpStatistics`.
- Whether the server replays every command, samples fields, or only logs them.
- Transport-layer compression, encryption, signing, or additional envelope metadata after protobuf serialization.
- A dedicated Guild Boss end builder; the battle type exists, but its final caller/request was not found in the supplied `NetworkUtils` decompilation.
- Whether the undecoded `JsonObject` attribute is definitely opt-in. Dumping `LevelEndData.GetJsonString()` at runtime is the cleanest confirmation.

## 8. Recommended read-only verification points

To close the remaining gaps without altering game state, capture these objects immediately before `NetWorkManager.Send`:

1. request runtime class name;
2. protobuf `CalculateSize()` and `ToByteArray()`;
3. for any request containing `Result`, every property of `BattleResultDto`, including the complete `PvpStatistics` object;
4. parse `Commands` as `BattleCommandAll` and count commands by `CommandId`;
5. invoke or log `LevelEndData.GetJsonString()` and compare its SHA-256 prefix to `FrameStatistics.ResultHashCode`;
6. log both request and response classes for crusade, guild war, cross-arena, kungfu, sparring, and trade ship.

That will distinguish “the class can store this field” from “this endpoint actually serialized a non-default value,” which static decompilation alone cannot always establish.
