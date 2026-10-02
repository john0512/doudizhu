# Dou Dizhu (Fight the Landlord)

Online 3-player Dou Dizhu with accounts, Tenhou-style ranks, and private tables. No extra packages — Node.js is enough.

## Run

```bash
chmod +x run.sh
./run.sh
```

Or: `node server/index.mjs`

Open [http://127.0.0.1:8000](http://127.0.0.1:8000) on this Mac. The server listens on all interfaces, so phones and other computers on the **same Wi‑Fi** can use the LAN URL printed at startup (for example `http://192.168.1.12:8000`). If macOS asks to allow incoming connections, choose Allow. Access from the public internet needs a tunnel or a hosted deploy — this process only serves your local network.

## Play

- **Account**: register or log in (username 3–16 letters, numbers, or `_`). New accounts start at **Peasant 0/10**.
- **Rated rooms**: Farm, Plantation, Apartment, and City. Each has a rank range. If you are outside it, joining shows an error. Seats are shuffled at match start. An **orbit** is 3 hands; the first bidder rotates once through each seat. Farm is 1 orbit, Plantation 2, Apartment and City 3.
- **Friendly room**: create a 6-character code. One hand, no rank change.
- **Scoring (hands)**: start from the winning bid (1–3). Double once per bomb or rocket. Double again (spring) if the landlord wins before either peasant plays. Landlord ±2S, split between the peasants. These table points only decide 1st / 2nd / 3rd at the end of the match (ties go to the earlier first-bidder seat).
- **Rank points**: 1st gains the room bonus (Farm +5, Plantation +8, Apartment +11, City +14). 2nd is +0. 3rd loses `2 × Dan` (0 at Peasant, 18 at 9 Dan). Landlord 3rd loses `18 + floor(points / 200)`. Reach the promotion threshold to move to the **starting (mid) points** of the next rank; go negative to drop to the midpoint of the previous rank. Extra points past the threshold or below 0 are discarded. Landlord has no cap.

```bash
node server/engine.test.mjs
node server/ranks.test.mjs
```
