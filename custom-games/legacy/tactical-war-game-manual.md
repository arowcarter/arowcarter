# Tactical Map War Game: Production & Logistics Manual (v2.1)
**WEGO Simultaneous Turns, Automatic Engagement & Multi-Action Edition**
*(Optimized for 11×17 Map Scale)*

---

## 1. Game Setup & Deployment
Before the first turn, players prepare the battlefield:
* **Starting Stockpile:** Each player begins with **6 Missiles** and a starting force of **2 Infantry** and **1 Light Vehicle**.
* **Main Base Placement:** Players alternate placing their **2 Original Main Bases**. Bases must be placed on land within **1.5 inches** of any map edge.
* **Initial Territory:** At the start of the game, the **3-inch Established Zone** around each active Main Base is immediately active for Air Defense deployment.

---

## 2. Simultaneous Turn Structure (WEGO)
Turns are no longer alternating. Each round is divided into two phases:

### Phase A: Planning Phase (Secret Orders)
1. **Player 1 (Blue)** spends up to **4 AP** to queue secret orders (Chained Move Paths, Missile Strikes, Production, Construction, Infantry-to-Resupply-Hub Conversion, and Repairs).
2. Player 1 clicks **Lock Orders**, triggering a **Hotseat Privacy Handoff** screen that hides all queued orders.
3. **Player 2 (Red)** spends up to **4 AP** to queue secret orders and clicks **Lock Orders**.

### Phase B: Resolution Phase (Simultaneous Execution)
Both players' orders execute simultaneously in four strict steps:
1. **Step 1 — Movement & Immediate Resupply:** All units animate leg-by-leg along their plotted paths simultaneously. Any **Spent** unit that touches or passes within contact (`0.62"`) of a friendly Base or Resupply Hub along any leg reloads immediately and is eligible to fire in Step 2.
2. **Step 2 — Automatic Engagement (0 AP):** All **Loaded** combat units automatically fire at the closest valid enemy within their engagement radius (ties broken by lowest target Health). Combat resolves simultaneously—mutual kills are possible. Any unit that participates in an engagement immediately becomes **Spent**.
3. **Step 3 — Missiles & Air Defense Interception:** All queued Missiles strike simultaneously. Defenders with Air Defense units within **3 inches** of the target roll **D4** interception.
4. **Step 4 — Logistics, Production & Construction:** Idle Resupply timers tick, facility and ruin cooldowns decrease, queued units spawn, 4 AP constructions/conversions/repairs complete *(canceled if the executing unit was destroyed in Steps 2–3)*, stationary units become **Secured**, and every 5 turns each player receives **+1 Missile**.

---

## 3. Base Classifications & Structures
| Structure | Shape | Health (D-Roll) | Produces | Notes |
| :--- | :--- | :---: | :--- | :--- |
| **Main Base** | Shield | 14 | All Land Units | Commander HQ. Immune to Missiles. Losing both Original Main Bases loses the match. |
| **Major Base** | Wheel | 10 | All Land Units | Heavy forward production hub. Does not count toward loss condition. |
| **Minor Base** | Disc | 8 | Inf, Light Veh, Air Def | Light forward production outpost. |
| **Port** | Big Star | 8 | Ships (4t CD) | Must be built on land adjacent to water. |
| **Air Base** | Big Heart | 6 | Planes (4t CD) | Airfield for Plane production. |
| **Resupply Hub** | Pot | 3 | None | Forward logistics depot. Reloads Spent friendly units on contact/pass. |

---

## 4. Unit Statistics & Automatic Engagement Reference
Units may chain multiple **1 AP** move legs in a single turn (Multi-Action Movement, up to 4 AP). Attacking is automatic and costs **0 AP**.

### Land Units
| Unit Type | Shape | Speed / Leg | Health (D-Roll) | Attack | Auto-Range | Prod. CD | Notes |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :--- |
| **Infantry** | Small Square | 1" | 2 | 2 | 1" | 2 Turns | Attacks Inf, SpecOps, Light Veh & Bases. Converts to **Resupply Hub** (4 AP when Secured). |
| **Special Forces** | Egg | 2" | 4 | 3 | 1" | 3 Turns | Attacks all land units & bases. Repairs general ruins. |
| **Light Vehicle** | Small Bead | 3" | 6 | 4 | 1" | 2 Turns | Fast all-purpose land unit. |
| **Heavy Vehicle** | Big Bead | 2" | 8 | 5 | 1" | 3 Turns | Heavy armor. Immune to standard Infantry. |
| **Air Defense** | Beehive | 2" | 4 | 4 | 3" | 2 Turns | Auto-engages Planes & intercepts Missiles (D4 within 3"). |

* **Road Bonus:** Any Land Unit starting on or traveling along a marked highway receives a **+1 inch** speed bonus for that move leg.

### Air & Sea Units
| Unit Type | Shape | Speed / Leg | Health (D-Roll) | Attack | Auto-Range | Prod. CD | Notes |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :--- |
| **Plane** | Small Heart | 4" | 6 | 5 | 3" | 4 Turns | Immune to land units (except Air Defense). |
| **Ship** | Small Star | 3" | 6 | 4 | 3" | 4 Turns | Water only; auto-engages land and sea targets within 3". |

---

## 5. Multi-Unit Combat Rules (Automatic Engagement)
* **0 AP Cost:** Units do not spend AP to attack.
* **Target Priority:** Each Loaded unit automatically targets the **closest** valid enemy within its engagement radius (ties broken by **lowest target Health**).
* **Automatic Combined Attack:** If multiple friendly Loaded units lock onto the same enemy target during Step 2, their Attack values automatically combine into a single Attack Roll (`1` to `Combined Attack Value`).
* **Defense Roll:** The defender rolls a die equal to the target's Health (`1` to `Health`).
* **Result:** If the Attacker's roll strictly exceeds the Defender's roll, the target is destroyed. All engagements resolve simultaneously, allowing mutual kills.

---

## 6. Missiles & Munitions
* **Starting Stockpile:** 6 Missiles per player.
* **Automatic Restock:** Every **5 turns**, each player receives **+1 Missile**.
* **Stats & Targeting:** Attack **8**, Unlimited Range, costs **1 AP** to queue. **Cannot target Main Bases.**
* **Air Defense Interception:** If the target is within **3 inches** of an enemy Air Defense (Beehive) unit during Step 3, the defender rolls a **D4**:
  * If the **D4 roll > Missile Attack Roll**, the missile is intercepted and destroyed mid-air.
  * If **D4 roll ≤ Missile Attack Roll**, the missile's attack roll is reduced by the D4 value.
  * Remaining attack value is compared against the target's Health D-Roll.

---

## 7. Production Facilities & Capabilities
* Producing a unit costs **2 AP** and places the producing facility on cooldown:
  * **Infantry / Light Vehicle / Air Defense:** 2 Turns
  * **Special Forces / Heavy Vehicle:** 3 Turns
  * **Planes / Ships:** 4 Turns

---

## 8. Construction, Territory & Field Resupply Hubs
### The Expansion Rule (Standard Construction)
1. **Secure Ground:** A unit must end a turn without moving to become **Secured** at the start of the next turn.
2. **Build (4 AP):** Spend **4 AP** (entire turn) during Planning. During Step 4 of Resolution, if the unit survived Steps 2–3, it is consumed and replaced by the chosen structure (**Major Base**, **Minor Base**, **Air Base**, or **Port** near water).

### Converting Infantry into a Resupply Hub
* Under the exact same **Expansion Rule**, a **Secured Infantry** unit may spend **4 AP** to convert into a permanent **Resupply Hub** (Pot Shape, Health 3).
* If the Infantry unit is destroyed during Step 2 (Auto-Engage) or Step 3 (Missiles) before Step 4 resolves, the conversion is canceled.

### The Established Zone (Air Defense)
* **Air Defense** units can be deployed within the **3-inch Established Zone** around any active friendly Base without requiring a Secured unit.

---

## 9. Repairs & Victory Condition
* **6-Turn Ruin Cooldown:** A destroyed structure becomes a Ruin for **6 turns**.
* **General Reconstruction:** After 6 turns, move an **Infantry** or **Special Forces** unit onto the Ruin and spend **4 AP**.
* **Main Base Reconstruction:** After 6 turns, spend **4 AP** directly on the Main Base Ruin (no unit required).
* **Victory Condition:** Both of an opponent's **Original Main Bases** are simultaneously destroyed.

---

## 10. Logistics: Single-Shot Ammo & The Resupply Loop
* **Single-Shot Ammo:** Every combat unit starts **Loaded**. Participating in an Automatic Engagement immediately makes the unit **Spent**.
* **Spent State:** A Spent unit can still move at full speed, chain multiple move legs, secure ground, or construct structures, but **cannot** auto-engage until reloaded.
* **Automatic Resupply:** A Spent unit reloads immediately upon touching or passing within contact (`0.62"`) of any friendly Base or Resupply Hub—including mid-movement during Step 1.
* **Idle Resupply:** If a Spent unit does not resupply at a Base or Hub, it reloads automatically in the field after **2 full turns**.

---

## 11. Action Point (AP) Quick Reference
Each player receives **4 AP** per Planning Phase:
* **Automatic Engagement:** `0 AP` (Automatic in Step 2)
* **Move Unit (1 Leg, Chainable up to 4×):** `1 AP`
* **Queue Missile Launch:** `1 AP`
* **Produce Unit:** `2 AP`
* **Construct / Convert Infantry to Resupply Hub / Repair Ruin:** `4 AP` (Entire turn)