"use client";

import { useState, useCallback, useEffect } from "react";
import { Icon, AdminGate, useAccount, useSignMessage, useOrg } from "@zk-whistleblower/ui";
import { getLeagues, getLeagueMembers } from "@zk-whistleblower/shared/src/leagueStore";
import { buildConsensusRequestMessage, buildConsensusVoteMessage, normalizeConsensusAdmins } from "@zk-whistleblower/shared/src/consensus";

// ─── Types ─────────────────────────────────────────────────────────────────

type VoteOption = "APPROVE" | "REJECT" | "ESCALATE" | "ABSTAIN";

interface ConsensusRequest {
  id: string;
  onChainReportId: string | number | null;
  reporterThreadId: string | null;
  selectedAdmins: string[];
  status: string;
  createdAt: string;
}

interface VoteTally {
  APPROVE: number;
  REJECT: number;
  ESCALATE: number;
  ABSTAIN: number;
}

interface AggregateResult {
  commitment: string;
  reportId: number;
  decision: number;
  timestamp: number;
  chain: number;
}

const DECISION_LABELS: Record<number, { label: string; color: string }> = {
  1: { label: "APPROVED", color: "text-green-400" },
  2: { label: "REJECTED", color: "text-red-400" },
  3: { label: "ESCALATED", color: "text-yellow-400" },
};

const VOTE_STYLES: Record<VoteOption, string> = {
  APPROVE: "bg-green-500/20 border-green-500/40 text-green-300 hover:bg-green-500/30",
  REJECT: "bg-red-500/20 border-red-500/40 text-red-300 hover:bg-red-500/30",
  ESCALATE: "bg-yellow-500/20 border-yellow-500/40 text-yellow-300 hover:bg-yellow-500/30",
  ABSTAIN: "bg-white/5 border-white/20 text-slate-400 hover:bg-white/10",
};

// ─── Step 1: Create / Open Consensus Request ────────────────────────────────

function CreateRequestPanel({
  onOpened,
}: {
  onOpened: (req: ConsensusRequest, created: boolean) => void;
}) {
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const { selectedOrgId } = useOrg();
  const [reportId, setReportId] = useState("");
  const [threadId, setThreadId] = useState("");
  const [adminAddrs, setAdminAddrs] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  // Pre-fill the admins text area with active admins who can review reports
  useEffect(() => {
    const leagues = getLeagues(selectedOrgId);
    const validLeagueIds = new Set(
      leagues.filter(l => l.permissions?.canReviewReports).map(l => l.id)
    );
    const members = getLeagueMembers(selectedOrgId);
    const validAdmins = members
      .filter(m => validLeagueIds.has(m.leagueId))
      .map(m => m.address);
    if (validAdmins.length > 0) {
      setAdminAddrs(validAdmins.join("\n"));
    }
  }, [selectedOrgId]);

  const handleCreate = useCallback(async () => {
    setError("");
    if (!reportId.trim()) {
      setError("Report ID is required.");
      return;
    }
    setPending(true);
    try {
      if (!address) {
        setError("Connect a wallet to open a consensus round.");
        return;
      }

      const selectedAdmins = normalizeConsensusAdmins(
        adminAddrs
          .split(/[\n,]+/)
          .map((a) => a.trim())
          .filter(Boolean)
      );

      if (selectedAdmins.length === 0) {
        setError("At least one selected admin is required.");
        return;
      }

      const creatorAddress = address.toLowerCase();
      const message = buildConsensusRequestMessage({
        orgId: selectedOrgId,
        reportId: Number(reportId.trim()),
        reporterThreadId: threadId.trim() || null,
        selectedAdmins,
        creatorAddress,
      });
      const signature = await signMessageAsync({ message });

      const body: Record<string, unknown> = {
        selectedAdmins,
        onChainReportId: Number(reportId.trim()),
        orgId: selectedOrgId,
        creatorAddress,
        signature,
      };
      if (threadId.trim()) body.reporterThreadId = threadId.trim();

      const res = await fetch("/api/consensus/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      onOpened(data.data as ConsensusRequest, data.created as boolean);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  }, [reportId, threadId, adminAddrs, onOpened, address, signMessageAsync, selectedOrgId]);

  return (
    <section className="card space-y-5">
      <div className="flex justify-between items-start mb-2">
        <div>
          <p className="step-label">01_INITIATE</p>
          <h2 className="section-heading">Open Consensus Round</h2>
        </div>
        <Icon name="how_to_vote" className="text-white/20 text-2xl" />
      </div>
      <p className="text-xs text-slate-500 font-mono">
        Enter a report ID to open a consensus round. If an active round already exists for that
        report, it will be returned instead of creating a duplicate.
      </p>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <label className="label">On-Chain Report ID <span className="text-red-400">*</span></label>
          <input
            id="consensus-report-id"
            className="input font-mono text-xs"
            placeholder="e.g. 11"
            value={reportId}
            onChange={(e) => setReportId(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <label className="label">Reporter Thread ID <span className="text-slate-600 font-normal normal-case">(optional)</span></label>
          <input
            id="consensus-thread-id"
            className="input font-mono text-xs"
            placeholder="Nullifier hash from report card"
            value={threadId}
            onChange={(e) => setThreadId(e.target.value)}
          />
        </div>
      </div>

      <div className="space-y-2">
        <label className="label">
          Selected Admins{" "}
          <span className="text-slate-600 font-normal normal-case">
            (wallet addresses, comma or newline separated)
          </span>
        </label>
        <textarea
          id="consensus-admins"
          className="w-full border border-white/20 bg-white/5 focus:bg-white/10 focus:border-white focus:outline-none px-3 py-2 font-mono text-xs text-white placeholder-slate-500 transition-colors resize-none"
          rows={3}
          placeholder={"0xABC…\n0xDEF…"}
          value={adminAddrs}
          onChange={(e) => setAdminAddrs(e.target.value)}
        />
        <p className="text-[10px] font-mono text-slate-600">
          The selected committee is fixed for the round and must contain at least one admin.
        </p>
      </div>

      <button
        id="consensus-create-btn"
        className="btn-primary"
        onClick={handleCreate}
        disabled={pending || !reportId.trim()}
      >
        {pending ? "Opening…" : "Open Consensus Round"}
      </button>

      {error && (
        <p className="bg-red-900/30 border border-red-500/30 p-3 text-xs text-red-400 font-mono">
          {error}
        </p>
      )}
    </section>
  );
}

// ─── Lookup by Report ID ────────────────────────────────────────────────────

function LookupPanel({
  onLoaded,
}: {
  onLoaded: (req: ConsensusRequest) => void;
}) {
  const [reportId, setReportId] = useState("");
  const [pending, setPending] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState("");

  const handleLookup = useCallback(async () => {
    if (!reportId.trim() || isNaN(Number(reportId))) return;
    setError("");
    setNotFound(false);
    setPending(true);
    try {
      const res = await fetch(`/api/consensus/request?reportId=${reportId.trim()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      if (!data.found) {
        setNotFound(true);
      } else {
        onLoaded(data.data as ConsensusRequest);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  }, [reportId, onLoaded]);

  return (
    <div className="space-y-3">
      <div className="flex gap-3 items-end">
        <div className="flex-1 space-y-2">
          <label className="label">Join by Report ID</label>
          <input
            id="lookup-report-id"
            className="input font-mono text-xs"
            placeholder="e.g. 11"
            value={reportId}
            onChange={(e) => { setReportId(e.target.value); setNotFound(false); setError(""); }}
            onKeyDown={(e) => e.key === "Enter" && handleLookup()}
          />
        </div>
        <button
          id="lookup-btn"
          className="btn-ghost shrink-0"
          onClick={handleLookup}
          disabled={!reportId.trim() || pending}
        >
          {pending ? "Searching…" : "Join Round"}
        </button>
      </div>
      {notFound && (
        <p className="text-[10px] font-mono text-yellow-400">
          ⚠ No active consensus round found for Report #{reportId}. Ask the admin who created it to share the report ID, or create a new round above.
        </p>
      )}
      {error && (
        <p className="text-[10px] font-mono text-red-400">{error}</p>
      )}
    </div>
  );
}

// ─── Step 2: Cast Vote ─────────────────────────────────────────────────────

function CastVotePanel({ requestId }: { requestId: string }) {
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();

  const [vote, setVote] = useState<VoteOption | "">("");
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [success, setSuccess] = useState("");
  const [error, setError] = useState("");

  const handleVote = useCallback(async () => {
    if (!vote || !address) return;
    setError("");
    setSuccess("");
    setPending(true);
    try {
      const normalizedAddress = address.toLowerCase();
      const message = buildConsensusVoteMessage({
        consensusRequestId: requestId,
        vote,
        adminAddress: normalizedAddress,
      });
      const signature = await signMessageAsync({ message });

      const res = await fetch("/api/consensus/vote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          consensusRequestId: requestId,
          adminAddress: normalizedAddress,
          vote,
          signature,
          reason: reason.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setSuccess(`Vote "${vote}" recorded ✓`);
      setVote("");
      setReason("");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  }, [vote, address, requestId, reason, signMessageAsync]);

  return (
    <section className="card space-y-5">
      <div className="flex justify-between items-start mb-2">
        <div>
          <p className="step-label">02_VOTE</p>
          <h2 className="section-heading">Cast Your Vote</h2>
        </div>
        <Icon name="gavel" className="text-white/20 text-2xl" />
      </div>

      <div className="bg-white/5 border border-white/10 p-3 font-mono text-xs text-slate-400 space-y-1">
        <p>
          <span className="text-slate-500">REQUEST_ID: </span>
          <span className="break-all">{requestId}</span>
        </p>
        <p>
          <span className="text-slate-500">VOTER: </span>
          {address ?? <span className="text-yellow-400">Connect wallet first</span>}
        </p>
      </div>

      <div className="space-y-2">
        <p className="label">Your Decision</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {(["APPROVE", "REJECT", "ESCALATE", "ABSTAIN"] as VoteOption[]).map((v) => (
            <button
              key={v}
              id={`vote-${v.toLowerCase()}`}
              className={`border px-3 py-3 text-xs font-bold uppercase tracking-widest transition-all ${VOTE_STYLES[v]
                } ${vote === v ? "ring-2 ring-white/30" : ""}`}
              onClick={() => setVote(v)}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <label className="label">
          Reason <span className="text-slate-600 font-normal normal-case">(optional)</span>
        </label>
        <textarea
          id="vote-reason"
          className="w-full border border-white/20 bg-white/5 focus:bg-white/10 focus:border-white focus:outline-none px-3 py-2 font-mono text-xs text-white placeholder-slate-500 transition-colors resize-none"
          rows={3}
          placeholder="Briefly explain your decision…"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </div>

      <button
        id="vote-submit-btn"
        className="btn-primary"
        onClick={handleVote}
        disabled={!vote || !address || pending}
      >
        {!address
          ? "Connect Wallet to Vote"
          : pending
            ? "Signing & Submitting…"
            : "Submit Vote"}
      </button>

      {success && <p className="text-[10px] font-mono text-green-400">{success}</p>}
      {error && (
        <p className="bg-red-900/30 border border-red-500/30 p-3 text-xs text-red-400 font-mono">
          {error}
        </p>
      )}
    </section>
  );
}

// ─── Step 3: Aggregate & Commit ─────────────────────────────────────────────

interface TallyInfo {
  counts: Record<VoteOption, number>;
  assigned: number;
  voted: number;
  majorityThreshold: number | null;
}

function VoteTallyDisplay({ tally }: { tally: TallyInfo }) {
  const { counts, assigned, voted, majorityThreshold } = tally;
  const needsToWin = majorityThreshold ?? 1;

  // Which option is leading?
  const leading = (Object.entries(counts) as [VoteOption, number][]).reduce(
    (best, [v, c]) => (c > best[1] ? [v, c] : best),
    ["APPROVE", 0] as [VoteOption, number]
  );
  const votesNeeded = Math.max(0, needsToWin - leading[1]);

  return (
    <div className="space-y-4">
      {/* Header stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white/5 border border-white/10 p-3 text-center">
          <p className="text-2xl font-black text-white">{voted}</p>
          <p className="text-[10px] font-mono text-slate-500 uppercase tracking-widest mt-1">Voted</p>
        </div>
        <div className="bg-white/5 border border-white/10 p-3 text-center">
          <p className="text-2xl font-black text-white">{assigned > 0 ? assigned : "∞"}</p>
          <p className="text-[10px] font-mono text-slate-500 uppercase tracking-widest mt-1">Assigned</p>
        </div>
        <div className="bg-white/5 border border-white/10 p-3 text-center">
          <p className="text-2xl font-black text-purple-400">{needsToWin}</p>
          <p className="text-[10px] font-mono text-slate-500 uppercase tracking-widest mt-1">For Supermajority</p>
        </div>
      </div>

      {/* Per-option bars */}
      <div className="space-y-2">
        {(Object.entries(counts) as [VoteOption, number][]).map(([v, count]) => {
          const pct = assigned > 0 ? Math.round((count / assigned) * 100) : 0;
          const reachedMajority = count >= needsToWin;
          return (
            <div key={v} className="space-y-1">
              <div className="flex justify-between items-center">
                <span className={`text-[10px] font-bold uppercase tracking-widest ${reachedMajority ? "text-white" : "text-slate-500"
                  }`}>
                  {v} {reachedMajority && "✓ MAJORITY"}
                </span>
                <span className="text-[10px] font-mono text-slate-400">
                  {count} / {assigned > 0 ? assigned : "?"}
                </span>
              </div>
              <div className="h-2 bg-white/5 border border-white/10 overflow-hidden">
                <div
                  className={`h-full transition-all duration-500 ${v === "APPROVE" ? "bg-green-500" :
                      v === "REJECT" ? "bg-red-500" :
                        v === "ESCALATE" ? "bg-yellow-500" : "bg-slate-500"
                    } ${reachedMajority ? "opacity-100" : "opacity-50"}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* Status message */}
      {assigned > 0 && (
        <div className={`p-3 text-xs font-mono border ${leading[1] >= needsToWin
            ? "bg-green-900/20 border-green-500/30 text-green-400"
            : votesNeeded === 1
              ? "bg-yellow-900/20 border-yellow-500/30 text-yellow-400"
              : "bg-white/5 border-white/10 text-slate-400"
          }`}>
          {leading[1] >= needsToWin
            ? `✓ ${leading[0]} has reached supermajority (${leading[1]}/${assigned} votes). Ready to anchor.`
            : `${voted}/${assigned} admin${voted !== 1 ? "s" : ""} voted · ${leading[0]} leads with ${leading[1]} vote${leading[1] !== 1 ? "s" : ""} · need ${votesNeeded} more for supermajority`
          }
        </div>
      )}
    </div>
  );
}

function AggregatePanel({ requestId }: { requestId: string }) {
  const [chainId, setChainId] = useState("11155111");
  const [tally, setTally] = useState<TallyInfo | null>(null);
  const [result, setResult] = useState<AggregateResult | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  const handleAggregate = useCallback(async () => {
    setError("");
    setPending(true);
    try {
      const res = await fetch("/api/consensus/aggregate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ consensusRequestId: requestId, chainId: Number(chainId) }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error ?? `HTTP ${res.status}`);

      // Always update tally
      if (data.tally) setTally(data.tally as TallyInfo);

      if (data.decided) {
        setResult(data.data as AggregateResult);
      } else {
        setResult(null);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  }, [requestId, chainId]);

  return (
    <section className="card space-y-5">
      <div className="flex justify-between items-start mb-2">
        <div>
          <p className="step-label">03_AGGREGATE</p>
          <h2 className="section-heading">Live Tally & Decision</h2>
        </div>
        <Icon name="lock" className="text-white/20 text-2xl" />
      </div>
      <p className="text-xs text-slate-500 font-mono">
        Refresh to see the current vote tally. Once majority is reached, the commitment is computed and ready to anchor on-chain.
      </p>

      <div className="flex gap-3 items-end">
        <div className="flex-1 space-y-2">
          <label className="label">Chain ID</label>
          <input
            id="aggregate-chain-id"
            className="input font-mono text-xs"
            placeholder="11155111 (Sepolia)"
            value={chainId}
            onChange={(e) => setChainId(e.target.value)}
          />
        </div>
        <button id="aggregate-btn" className="btn-ghost shrink-0" onClick={handleAggregate} disabled={pending}>
          {pending ? "Refreshing…" : tally ? "↻ Refresh" : "Check Status"}
        </button>
      </div>

      {tally && <VoteTallyDisplay tally={tally} />}

      {result && (
        <div className="bg-green-900/20 border border-green-500/30 p-4 space-y-3">
          <div className="flex items-center gap-3">
            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Decision</span>
            <span className={`text-sm font-black uppercase ${DECISION_LABELS[result.decision]?.color ?? "text-white"}`}>
              {DECISION_LABELS[result.decision]?.label ?? `Code ${result.decision}`}
            </span>
          </div>
          <div className="space-y-1 font-mono text-xs text-slate-400">
            <p><span className="text-slate-500">REPORT_ID: </span>{result.reportId}</p>
            <p><span className="text-slate-500">CHAIN: </span>{result.chain}</p>
            <p><span className="text-slate-500">TIMESTAMP: </span>{new Date(result.timestamp * 1000).toLocaleString()}</p>
          </div>
          <div>
            <p className="text-[10px] font-mono text-slate-500 uppercase tracking-widest mb-1">
              Commitment Hash (keccak256)
            </p>
            <p className="break-all font-mono text-xs text-green-300 bg-black/30 p-2 border border-green-500/20">
              {result.commitment}
            </p>
            <p className="mt-2 text-[10px] font-mono text-slate-600">
              ↳ Have each selected admin sign this commitment with their wallet, then submit the aggregated signatures to the{" "}
              <code className="text-slate-400">WhistleblowerRegistry</code> contract.
            </p>
          </div>
        </div>
      )}

      {error && (
        <p className="bg-red-900/30 border border-red-500/30 p-3 text-xs text-red-400 font-mono">
          {error}
        </p>
      )}
    </section>
  );
}

// ─── Main Page ──────────────────────────────────────────────────────────────

export default function ConsensusPage() {
  const [activeRequest, setActiveRequest] = useState<ConsensusRequest | null>(null);
  const [wasExisting, setWasExisting] = useState(false);

  const handleOpened = useCallback((req: ConsensusRequest, created: boolean) => {
    setActiveRequest(req);
    setWasExisting(!created);
  }, []);

  const handleLoaded = useCallback((req: ConsensusRequest) => {
    setActiveRequest(req);
    setWasExisting(true);
  }, []);

  return (
    <AdminGate requirePermission="canReviewReports">
      <div className="space-y-12">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-white text-4xl font-black leading-none tracking-tighter mb-3 uppercase italic">
            Consensus
          </h1>
          <div className="flex items-center gap-4">
            <span className="px-2 py-1 bg-purple-500 text-black text-[10px] font-bold uppercase tracking-widest">
              Multi-Admin
            </span>
            <p className="text-slate-500 text-sm font-mono tracking-tight">
              Collective decision-making // On-chain commitment anchoring
            </p>
          </div>
        </div>

        {/* Step 1 — Create or reopen */}
        <CreateRequestPanel onOpened={handleOpened} />

        {/* Join by Report ID */}
        <section className="card space-y-4">
          <div className="flex justify-between items-start mb-2">
            <div>
              <p className="step-label">OR_JOIN</p>
              <h2 className="section-heading">Join Existing Round</h2>
            </div>
            <Icon name="restart_alt" className="text-white/20 text-2xl" />
          </div>
          <p className="text-xs text-slate-500 font-mono">
            If another admin already opened a round, enter the report ID to join it directly.
          </p>
          <LookupPanel onLoaded={handleLoaded} />
        </section>

        {/* Active request */}
        {activeRequest && (
          <>
            {/* Banner */}
            <div className={`border p-4 flex items-start justify-between gap-4 ${wasExisting
                ? "bg-blue-500/10 border-blue-500/30"
                : "bg-purple-500/10 border-purple-500/30"
              }`}>
              <div className="space-y-1 min-w-0">
                <p className={`text-[10px] font-mono uppercase tracking-widest ${wasExisting ? "text-blue-400" : "text-purple-400"}`}>
                  {wasExisting ? "Joined Existing Round" : "New Round Created"}
                  {activeRequest.onChainReportId !== null && ` — Report #${activeRequest.onChainReportId}`}
                </p>
                <p className="font-mono text-xs text-white break-all">{activeRequest.id}</p>
                {activeRequest.selectedAdmins.length > 0 && (
                  <p className="text-[10px] font-mono text-slate-500">
                    {activeRequest.selectedAdmins.length} admin(s) assigned to vote
                  </p>
                )}
              </div>
              <button
                className="text-slate-500 hover:text-white text-sm shrink-0"
                onClick={() => setActiveRequest(null)}
                title="Close"
              >
                ✕
              </button>
            </div>

            <CastVotePanel requestId={activeRequest.id} />
            <AggregatePanel requestId={activeRequest.id} />
          </>
        )}

        {!activeRequest && (
          <p className="text-center text-[10px] font-mono text-slate-600 uppercase tracking-widest">
            Open or join a consensus round above to begin voting.
          </p>
        )}
      </div>
    </AdminGate>
  );
}
