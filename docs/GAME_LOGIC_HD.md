# Game Logic HD

This file is the high-detail game logic and architecture reference for `Neural Bastion`.

Rule:
Every gameplay or game-logic change must update this file in the same change set.
This includes combat rules, rewards, upgrades, legendary perks, wave flow, room flow, economy, and player-facing battle behavior.
If a temporary screenshot is added to diagnose a bug, that screenshot must be deleted as soon as it has been read and is no longer needed, in the same fix change set.

## Core Loop

1. The run starts on the route map.
2. The opening map view shows the base in the center.
3. Three opening routes extend from the base: northwest, northeast, and south.
   - northwest branch: worms
   - northeast branch: beetles
   - south branch: spiders
4. Each opening route is a `combat` node.
5. Only the very first battle of the run uses a pre-battle reward-upgrade screen.
6. After that first upgrade is applied, the battle begins.
7. Later combat nodes begin immediately when chosen from the map.
8. During combat, enemies walk toward the base while the player-owned neural network charges the turret.
9. On wave clear, elite and boss rooms show their legendary reveal once, before the post-combat reward.
10. After that, the post-combat reward appears immediately instead of waiting for a separate finish step.
11. After the player applies that reward and manually finishes battle, the run returns to the map focused on the cleared node.
12. New child routes generate from the cleared node:
   - normally `2` choices
   - `1` choice with `10%` probability
13. Child routes can be `combat`, `elite`, `shop`, or `camp`.
14. At branch depth `12`, the branch stops normal random generation and guarantees exactly two pre-boss choices: `shop` and `camp`.
15. Those `shop/camp` nodes lead into the final `boss`, which now appears at branch depth `13`.
16. Clearing a `boss`, applying its reward, and pressing `Finish Battle` ends that branch, saves meta-progress to `localStorage`, and restarts the route map from the base.
17. After a branch restart, the completed branch root remains visibly opened/cleared and cannot be chosen again, while the remaining root branches stay available.
18. The full cleared route of that finished branch should remain visible on the map as a remembered completed path.
19. After each completed branch, enemies in the remaining branches gain a large HP boost.

## Architecture

- [src/main.js](/home/dev/rnn-glider/src/main.js)
  Bootstraps the world, input, game loop, and ordered systems.
- [src/ecs/world.js](/home/dev/rnn-glider/src/ecs/world.js)
  Minimal ECS storage and query layer.
- [src/game/systems.js](/home/dev/rnn-glider/src/game/systems.js)
  Main gameplay rules, rendering, UI overlays, combat, rewards, rooms, and HUD.
- [src/game/network.js](/home/dev/rnn-glider/src/game/network.js)
  Neural-network signal simulation, charge flow, lane packets, and opening volley logic.
- [src/game/upgrades.js](/home/dev/rnn-glider/src/game/upgrades.js)
  Upgrade catalog, target validation, and node mutation.
- [src/game/spawners.js](/home/dev/rnn-glider/src/game/spawners.js)
  Enemy, projectile, flash, and floating-text entity factories.
- [src/game/config.js](/home/dev/rnn-glider/src/game/config.js)
  Shared gameplay constants and colors.

## Debug Mode

- A hidden debug mode is available from the game page through `#dev` or `?dev=1`.
- Debug mode is a local testing tool and must not depend on any backend.
- It allows selecting a branch theme, a target tree depth, a pre-boss `shop/camp` preference, a jump mode, a custom upgrade count loadout, and owned legendary perks.
- Applying a debug scenario starts from a clean temporary run state and must not import meta progression from `localStorage`.
- Debug jump should let the tester skip to the chosen branch depth and optionally enter the next room immediately.
- Debug build should auto-apply the requested upgrade counts onto the network in deterministic order so combat setups are reproducible enough for iteration.

## Battlefield Model

- Portrait-first battlefield on a `16x16` logical grid.
- One central turret defends the base.
- Enemies spawn at the top and move downward.
- The neural network belongs to the player and sits below the combat lane.
- The turret sits above the network.
- When shield is active, it exists as a visible barrier in front of the base platform, closer to the enemies than base HP.
- Shield collision must follow the outer curved dome of the shield, not a flat horizontal line.
- When shield is gained, the dome should animate in rather than appearing instantly.
- Combat must still remain readable on desktop by preserving a portrait-like aspect ratio.

## Neural Network Model

- There are `5` lanes.
- There are `3` network layers.
- Signal is processed lane-by-lane in the normal cycle.
- Visual charge should read as:
  `input neuron -> intermediate routing -> output neuron -> turret`
- Signal must travel in visible stages from the lowest active neuron upward.
- A neuron should not emit its outgoing signal before that neuron itself has visibly charged.
- The route should not light up all at once; each layer hands off to the next layer in sequence.
- Route speed is controlled by neural charge transfer, not by a separate turret cooldown.
- If route fire-rate bonuses exist, they accelerate the network transfer timings themselves.
- The turret does not switch to the next source lane until the current packet has fully reached the turret and been fired.
- Turret charge buildup should visibly fill before each queued shot releases, rather than snapping instantly from route arrival to muzzle flash.
- Turret visuals should show stored pressure in the base, a brighter core, and visible buildup in the barrel before discharge, not just a flat bar fill.
- Once a packet has already left the lower source layer and is in the turret-shot phase, the first row should not keep pulsing as if a fresh packet started again.
- During the turret-shot phase, lower network connections should remain visibly active and held, but they should not replay the travel animation again.
- Those held connections should only fade after the packet finishes firing and the route releases.
- The top network layer must also stay in a steady held state during turret-shot phase; only the outgoing `output -> turret` channel should keep animating.
- The `output -> turret` channel should not replay a fresh travel pass for every shot in the same packet; during shot-phase it should stay as a held active route and vary only in intensity.

### Topology

- `leftLink`
  Sends strong extra signal to the left neuron in the next layer.
- `rightLink`
  Sends strong extra signal to the right neuron in the next layer.
- `divider`
  Splits sideways into left and right neighbors in the same layer.
- `merger`
  Pulls sideways from left and right neighbors into the current neuron.

Validation rules:
- `leftLink` and `rightLink` cannot be placed on the final layer.
- `divider` and `merger` can be placed on any layer.
- If the player owns `Resonant Mesh`, adjacent neurons on the same layer that carry the same upgrade type automatically form sideways links during battle.

## Turret Rules

- There is one turret, not five independent cannons.
- The turret rotates toward its current target.
- The turret has no separate intrinsic fire delay once a charge packet has reached it.
- As soon as the current packet has visibly arrived at the turret, the turret fires immediately.
- Multi-output packets should still fire in order, one shot after another, but at a very high burst rate driven by successive charge arrivals rather than by a separate gun cooldown.
- The turret uses the full route effects gathered from the active path.
- `Overdrive` currently gives `+120%` route damage per stack and also scales the strength of applied statuses on that route.
- `Overdrive` is aggregated from the full energized packet path, including branched/link-connected nodes, rather than only the straight source/output column.
- `Summon Node` is a local neuron upgrade that creates allied copies whenever signal passes through that neuron.
- Each summon travels upward in the summoning neuron's lane and detonates on first enemy contact for damage equal to its own HP.
- During boss fights, summon effects still create ordinary branch enemies rather than boss copies.

## Enemies

- Standard enemies are small robotic spiders with different silhouettes.
- Worm-branch enemies are visibly longer than the other families.
- Beetle-branch enemies are visibly larger and bulkier than the other families, especially elites and bosses.
- Worms do not travel straight down; they keep the same vertical advance but weave left-right-left in a zigzag while descending.
- Worm zigzag uses the real enemy position for targeting, collisions, damage numbers, drops, and rendering rather than only faking the motion visually.
- Elite rooms spawn one very large spider.
- Elite enemy is slow, tanky, and causes immediate run loss if it reaches the base.
- Early standard waves spawn fewer enemies than before and scale upward more gradually from wave to wave.
- Remaining branches become much tankier after branch clears: enemy HP is multiplied by `1.75x` after one completed branch and `2.5x` after two completed branches.
- Enemies show visible status effects.
- Enemies have hit-react feedback and a longer death burst.

## Damage Rules

- Direct projectile damage is applied on hit.
- `Fire` applies burn DoT.
- `Void Curse` applies curse DoT.
- `Slow` reduces movement speed.
- `Freeze` temporarily stops movement.
- `Pushback` pushes enemies upward but must not push them out of the visible battle zone.
- `Penetration` lets a projectile continue through additional targets.
- `Fire` and `Void Curse` can coexist on the same enemy at the same time.
- Repeated `Fire` hits stack additively instead of merely refreshing duration.
- Burn intensity is capped at `20`.
- Repeated `Void Curse` hits also stack additively.
- Repeated `Fire` and `Void Curse` hits also refresh a short hold window before decay starts, so rapid repeated hits visibly build the stack instead of immediately bleeding it away.
- Enemy contact resolves against shield first if shield is present, using the forward shield barrier instead of the base line.
- Shield contact uses the curved outer shield arc at the enemy lane position.
- Enemies with an active personal shield ignore `slow` and `freeze`.
- Enemies with an active personal shield also ignore `pushback`.
- Periodic statuses have an explicit `throughShield` rule.
- `Void Curse` is a through-shield periodic effect and keeps damaging through enemy shield.
- Any periodic effect without `throughShield` should still tick against the enemy shield first.
- A non-through-shield periodic effect must not leak any remainder into HP during the same tick while shield was still present.
- `Burn` is not a through-shield periodic effect: it can be applied to a shielded enemy, it burns the shield down over time, and only starts hurting HP after the shield is gone.
- Shield contact does not instantly kill the enemy.
- On shield contact, shield loses `1`, the enemy takes `1` damage, is pushed back by about its own size, and is briefly stopped before resuming.
- This shield contact rule applies to regular enemies, elites, minibosses, and bosses. Base HP is only threatened after shield is gone.
- Enemy pushback behavior is driven by enemy-side resistance properties, not by projectile-side special cases.
- Bosses use `pushbackResistance = 0.25`, so bullets push them 75% less than normal enemies.
- Bosses use `shieldKnockbackDistance = 0.25`, so the base shield only knocks them back by a quarter of their size on contact.
- Enemies with personal shields should render a visible shield shell around the body, react when shield is hit, and show a stronger shield-break flash when the personal shield collapses.
- Base HP is only hit after shield is gone.

DoT visibility rules:
- Burn and curse must show floating damage numbers.
- Hit feedback on enemies must be visible.
- Base damage feedback must also be visible.
- Larger damage numbers must render with larger floating text than smaller hits.

## Rewards And Upgrades

- Standard upgrades are dragged onto a specific neuron.
- Camp rooms are no longer passive healing stops.
- Camp now presents a choice: either heal the base for `+3 HP` or open a reward-style drag screen that lets the player drop a one-time `Empower Neuron` buff onto any node.
- The camp empower buff adds `+1` white route damage to the chosen neuron without replacing its installed upgrade.
- After applying the camp neuron upgrade, the run should enter a short `camp_finish` review state so the player can inspect or rearrange the lattice before returning to the map.
- A newly offered upgrade may only be dropped onto an empty neuron or merged into a neuron that already has the same upgrade type.
- A newly offered upgrade must not overwrite a different installed item.
- Reward UI shows three upgrade options.
- Reward UI supports paid rerolls: the player may spend money to roll a new set of three reward upgrades.
- Reward reroll cost starts at `$8` and increases by `$6` for each reroll within the same reward screen.
- Reward UI also exposes `Leave`, allowing the player to skip the offered reward and continue the current flow without taking any upgrade.
- The player should see upgrade preview, name, short text, and description before dragging.
- Every successfully applied upgrade also gives that neuron `+1` plain white route damage.
- That white damage only matters when a real signal reaches the neuron; an upgraded output neuron must not fire by itself without incoming charge.
- Standard battle-entry rewards now happen before entering `combat` or `elite` map nodes, not after clearing them.
- Only the first battle-entry reward is pre-combat.
- All later standard rewards are post-combat and return to the map after the upgrade is placed.
- Reward overlays must stay transparent enough to keep existing network connections visible.
- During `reward_drag` and `shop`, the player may also drag an already-installed neuron module to another neuron.
- Installed neuron modules may be rearranged in any non-combat phase where the network is visible, not only in reward/shop.
- Dropping onto an empty valid neuron moves the installed module.
- Dropping onto an occupied valid neuron swaps the two modules.
- Dropping onto an occupied neuron with the same installed upgrade type merges the two modules if the combined level does not exceed the max merge limit.
- If either side of the move would violate placement rules, the rearrangement is invalid and nothing changes.
- Applying the same upgrade type onto the same neuron merges and strengthens that upgrade instead of behaving like a separate install.
- Same-type upgrades can merge up to `3` levels on one neuron.
- Merge strength is still implemented as summed upgrade values under the hood.
- When a same-type merge happens, the game should show a short fusion animation from two matching upgrade glyphs into one brighter upgraded neuron state.
- Higher-level merged upgrades should render brighter and more intense than level `1`.
- `Summon Node` replaces the old fire-rate upgrade.

## Legendary Perks

Legendary perks are global player properties.
They are not applied to a specific neuron.

Acquisition rules:
- A legendary perk drops automatically after winning an `elite` or `boss` room.
- The player does not choose it.
- One random perk is granted from the available pool.
- The legendary reveal happens once, immediately after the room is cleared and before the post-combat upgrade reward.

Legendary reveal flow:
- First, a dedicated reveal panel shows the new legendary perk with icon and description.
- The player closes that panel with an explicit `OK` button.
- Then the perk icon animates into a small badge in the upper-left HUD area.
- The badge remains visible for the rest of the run.
- After that, the player can tap/click the badge to reopen its inspect popup.
- The legendary inspect popup stays open until the player taps/clicks outside the badge.
- Neuron inspect uses the same anchored popup style and also closes only on outside tap/click.
- After the reveal finishes, the normal post-combat upgrade reward begins.

Current legendary perk pool:

- `Opening Barrage`
  At battle start, all five input neurons are charged immediately.
  This should create a full opening volley, including any topology amplification from links, divider, or merger.

- `Thermal Feedback`
  Every time freeze is applied during the current battle, burn damage gains `+20%` for the rest of that battle.

- `Void Resonance`
  Every time slow is applied during the current battle, void curse damage gains `+20%` for the rest of that battle.

- `Rapid Chamber`
  Network charge transfer speed is increased by `100%`, which makes the turret fire sooner because charges arrive sooner.

- `Resonant Mesh`
  Adjacent neurons with the same installed upgrade type automatically create sideways links between each other during battle.

Battle-scoped legendary counters:
- Freeze-to-fire bonus resets at the start of each battle.
- Slow-to-void bonus resets at the start of each battle.

Run-scoped legendary properties:
- Owned legendary perks persist for the whole run.

## Rooms

Map rules:
- The route map is a branching tree focused on the current cleared node.
- The opening map always shows the base in the center with `3` opening `combat` routes.
- After a branch boss is cleared, the route map restarts from the base instead of continuing from the boss node.
- Completed root branches stay marked as cleared/closed and cannot be selected again.
- Completed branches should also keep their previously traveled path visually drawn on the map after the run returns to base.
- When a node is cleared, newly generated child routes appear from that node.
- The map replaces the old door-choice screen.
- Selectable route nodes should be visually brighter and use a generous touch/click hit area rather than requiring precision taps.
- The map should avoid redundant top-screen HUD panels; available route nodes themselves are the primary interaction cue.
- Selectable route nodes should use a subtle bounce/hover-like idle motion so the player can immediately see what is clickable.
- Node labels should sit clearly below the node icon and move in sync with the node's idle bounce instead of drifting separately.
- At depth `12`, a branch should force a two-choice `shop/camp` pre-boss fork.
- At depth `13`, that branch should end in a single `boss` node instead of further normal branching.
- Each branch keeps its own enemy faction from the opening split and passes that faction down through later child nodes.
- The map should provide a `Reset Save` button that clears `localStorage` meta-progress and restores a fresh run.
- The map is scrollable: the player can drag the map to pan the camera.
- The map camera automatically resets to center on the current focus node whenever the map is opened or a room is cleared.
- A `Recenter` button is available on the map to manually reset the camera focus.

- `combat`
  Standard wave.
- `elite`
  One giant spider. If it reaches the base, the run ends.
- `boss`
  A single enormous spider. This is the end of that branch.
- `shop`
  Spend money on upgrades and repairs.
- `camp`
  Restore HP.

Boss rules:
- The boss spawns alone.
- Spider boss is the only boss with a personal shield equal to its HP.
- While a boss personal shield is active, `slow` and `freeze` do not apply.
- Beetle boss has no personal shield and summons one fast `1 HP` beetle every `1s`.
- Worm boss has no personal shield, begins as a large butterfly-form boss, and only splits into `2` elite worms when that first form is killed.
- Bosses now sweep side to side across the battlefield instead of falling straight down, reducing their average advance speed and making the fight read as a boss pattern rather than a normal lane push.

Branch enemy themes:
- South branch uses spider enemies.
- Northwest branch uses worm enemies.
- Worm encounters should feel serpentine: longer bodies, sideways weave, same downward pressure.
- Northeast branch uses slow but very durable beetle enemies.
- Normal, elite, and boss encounters on a branch inherit that branch's faction theme.
- After one branch has been completed, future normal combat waves also mix in enemy families from already completed branches.
- With one completed branch, future normal waves use two enemy families and enemy counts scale up roughly 2x.
- With two completed branches, future normal waves use all three enemy families and enemy counts scale up roughly 3x.

## Economy

- Money is earned by killing enemies.
- Money is not added directly to the wallet on enemy death.
- Enemies drop money pickups onto the battlefield.
- On touch devices, the player can collect money by touching and sweeping across drops, with a larger pickup radius than mouse hover so precise aiming is not required.
- On desktop, hovering the mouse over money drops collects them.
- Collected money animates into the wallet before it is added to the run total.
- Uncollected money remains on the battlefield across reward, map transitions, shop, camp, and later combats until the player collects it.
- Money that has already been picked up and is mid-flight to the wallet should still finish its flight and then be added.
- Shop repairs restore base HP.
- Shop upgrades are drag-and-drop onto neurons, like reward upgrades.
- Shop also supports paid rerolls for its stock.
- Shop reroll cost starts at `$10` and increases by `$8` for each reroll within the same shop visit.
- Meta-progression is saved to `localStorage` when a branch is completed.
- The saved meta state preserves the player build and completed branch list, then reloads the map from the base on the next start.

## UI Rules

- Buttons and overlays must not block important drag targets in the network.
- Reward and shop overlays should preserve visibility of already-installed network links.
- Tapping a neuron in combat, reward drag, or shop should open a small stat card for that neuron.
- A drag attempt on an installed neuron must not open the inspect popup on release; inspect should only open from a clean tap/click without dragging.
- Neurons with stacked status upgrades should glow brighter as their local effect stacks increase.
- Debug behavior is secondary and should not interfere with gameplay.

## Maintenance Rule

When changing gameplay logic, update at least these sections if relevant:

- Core Loop
- Neural Network Model
- Turret Rules
- Enemies
- Damage Rules
- Rewards And Upgrades
- Legendary Perks
- Rooms
- Economy
- UI Rules
