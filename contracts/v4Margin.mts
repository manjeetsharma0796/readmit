// engine/src/analyzers/v4Margin.ts (draft). Pure viem, no Uniswap SDK needed.
import { createPublicClient, http, keccak256, encodePacked, type Hex, type Address } from "viem";

export const PM = "0x6bF9Aa9c04fd001385742d61f6818C3236429848" as Address;  // re-read 1337.json after a reset
export const STATE_VIEW = "0xd89a052862AaA34f0B6cc7f3B6a9D080584a43FB" as Address;
const POOLS_SLOT = 6n; // v4-core StateLibrary.POOLS_SLOT
const Q96 = 2n ** 96n;
const sv = [
  { type: "function", name: "getSlot0", stateMutability: "view", inputs: [{ type: "bytes32" }],
    outputs: [{ type: "uint160" }, { type: "int24" }, { type: "uint24" }, { type: "uint24" }] },
  { type: "function", name: "getLiquidity", stateMutability: "view", inputs: [{ type: "bytes32" }], outputs: [{ type: "uint128" }] },
] as const;

/** Find v4 pools whose slot0 a VERIFY frame read. `keccak` = trace preimages (accumulated; take the last frame's),
 *  `readSlots` = keys of accessedSlots.reads on the PM address, collected over the frame's nested calls. */
export function poolsReadInVerify(keccak: Hex[], readSlots: Hex[]): Hex[] {
  const read = new Set(readSlots.map((s) => s.toLowerCase()));
  return keccak.filter((p) => p.length === 2 + 128 && BigInt("0x" + p.slice(66)) === POOLS_SLOT)
    .map((p) => ("0x" + p.slice(2, 66)) as Hex)
    .filter((id) => read.has(keccak256(encodePacked(["bytes32", "uint256"], [id, POOLS_SLOT])).toLowerCase()));
}

const isqrt = (n: bigint) => { if (n < 2n) return n; let x = n, y = (x + 1n) / 2n; while (y < x) { x = y; y = (x + n / x) / 2n; } return x; };

/** currency1 in (zeroForOne=false) that pushes price to where quote(maxCost) > paid. Exact for one in-range
 *  liquidity band (our full-range pool); confirm with V4Quoter.quoteExactInputSingle via eth_call. */
export async function flipMargin(rpcUrl: string, poolId: Hex, maxCostWei: bigint, paid: bigint, markupBps = 11_000n, feePips = 3000n) {
  const c = createPublicClient({ transport: http(rpcUrl) });
  const [[sqrtP], L] = await Promise.all([
    c.readContract({ address: STATE_VIEW, abi: sv, functionName: "getSlot0", args: [poolId] }),
    c.readContract({ address: STATE_VIEW, abi: sv, functionName: "getLiquidity", args: [poolId] }),
  ]);
  // owed = maxCost * sqrtP^2 / 2^192 * markup  >  paid   <=>   sqrtP > sqrt(paid * 2^192 * 1e4 / (maxCost * markup))
  const sqrtStar = isqrt((paid * Q96 * Q96 * 10_000n) / (maxCostWei * markupBps));
  if (sqrtP >= sqrtStar) return { sqrtP, sqrtStar, L, currency1In: 0n, alreadyUnderpaid: true };
  const net = (L * (sqrtStar - sqrtP)) / Q96;                 // Δy = L·Δ√P
  return { sqrtP, sqrtStar, L, currency1In: (net * 1_000_000n) / (1_000_000n - feePips), alreadyUnderpaid: false };
}

// self-check: preimage matcher + live StateView read on an existing devnet pool
const id = (process.argv[2] ?? "0x4006597ef0c82c9f357b1edefaf8b1b780c3434576d152eae10e098b342837d8") as Hex;
const pre = (id + POOLS_SLOT.toString(16).padStart(64, "0")) as Hex;
const slot = keccak256(encodePacked(["bytes32", "uint256"], [id, POOLS_SLOT]));
console.assert(poolsReadInVerify([pre], [slot])[0] === id, "matcher");
console.assert(poolsReadInVerify([pre], []).length === 0, "matcher requires the read");
console.log(await flipMargin("https://altmempool.forshtat.com", id, 10n ** 15n, 3_300_000n));
