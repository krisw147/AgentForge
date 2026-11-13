"use client";

import {
  Check,
  CheckCircle2,
  Clock3,
  RefreshCw,
  ShieldCheck,
  X
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { AgentMark } from "@/components/AgentMark";
import { EmptyState } from "@/components/EmptyState";
import { LoadingState } from "@/components/LoadingState";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { api } from "@/lib/api";
import { formatDate, shortId } from "@/lib/format";
import type { Run } from "@/lib/types";

type ApprovalItem = {
  approval: NonNullable<Run["approval"]>;
  run: Run;
};

export default function ApprovalsPage() {
  const [items, setItems] = useState<ApprovalItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [acting, setActing] = useState("");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [showHistory, setShowHistory] = useState(false);

  const load = () => {
    setLoading(true);
    api
      .approvals(showHistory ? "" : "pending")
      .then((response) =>
        setItems(
          response.filter(
            (item): item is ApprovalItem => Boolean(item.approval && item.run)
          )
        )
      )
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, [showHistory]);

  const decide = async (item: ApprovalItem, approved: boolean) => {
    setActing(item.approval.id);
    try {
      await api.decideApproval(
        item.approval.id,
        approved,
        notes[item.approval.id] ||
          (approved ? "订单与金额已核验，允许执行。" : "风险信息不足，驳回操作。")
      );
      load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setActing("");
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="HUMAN IN THE LOOP"
        title="审批中心"
        description="敏感工具执行前会被暂停。审批后，运行引擎会从持久化检查点继续。"
        actions={
          <div className="segmented-control">
            <button
              className={!showHistory ? "active" : ""}
              onClick={() => setShowHistory(false)}
              type="button"
            >
              待处理
            </button>
            <button
              className={showHistory ? "active" : ""}
              onClick={() => setShowHistory(true)}
              type="button"
            >
              全部记录
            </button>
          </div>
        }
      />

      <section className="approval-principles">
        <div>
          <span className="principle-icon principle-icon--amber">
            <ShieldCheck size={18} />
          </span>
          <div>
            <strong>策略拦截</strong>
            <p>退款等写操作自动进入审批</p>
          </div>
        </div>
        <div>
          <span className="principle-icon principle-icon--violet">
            <Clock3 size={18} />
          </span>
          <div>
            <strong>检查点恢复</strong>
            <p>审批过程中运行状态不会丢失</p>
          </div>
        </div>
        <div>
          <span className="principle-icon principle-icon--green">
            <CheckCircle2 size={18} />
          </span>
          <div>
            <strong>完整审计</strong>
            <p>每次决定都写入不可变事件流</p>
          </div>
        </div>
      </section>

      {error ? (
        <div className="inline-alert inline-alert--danger">{error}</div>
      ) : null}
      {loading ? (
        <LoadingState label="正在加载审批队列" />
      ) : items.length ? (
        <div className="approval-cards">
          {items.map((item) => (
            <article className="panel approval-card" key={item.approval.id}>
              <div className="approval-card-head">
                <div className="approval-card-agent">
                  <AgentMark
                    icon={item.run.agent?.icon}
                    color={item.run.agent?.color}
                    size="md"
                  />
                  <div>
                    <div>
                      <strong>{item.run.agent?.name}</strong>
                      <StatusBadge status={item.approval.status} />
                    </div>
                    <span>
                      Run {shortId(item.run.id)} ·{" "}
                      {formatDate(item.approval.requestedAt)}
                    </span>
                  </div>
                </div>
                <Link className="text-link" href={`/runs/${item.run.id}`}>
                  查看 Trace
                </Link>
              </div>
              <div className="approval-card-body">
                <span className="approval-risk-label">敏感操作</span>
                <h3>退款工具请求执行许可</h3>
                <p>{item.approval.reason}</p>
                <div className="approval-request-box">
                  <span>用户请求</span>
                  <strong>{item.run.input}</strong>
                </div>
              </div>
              {item.approval.status === "pending" ? (
                <>
                  <textarea
                    className="approval-note-input"
                    onChange={(event) =>
                      setNotes({
                        ...notes,
                        [item.approval.id]: event.target.value
                      })
                    }
                    placeholder="添加审批备注（可选）"
                    rows={2}
                    value={notes[item.approval.id] || ""}
                  />
                  <div className="approval-card-actions">
                    <button
                      className="button button--danger-ghost"
                      disabled={acting === item.approval.id}
                      onClick={() => decide(item, false)}
                      type="button"
                    >
                      <X size={15} />
                      驳回
                    </button>
                    <button
                      className="button button--primary"
                      disabled={acting === item.approval.id}
                      onClick={() => decide(item, true)}
                      type="button"
                    >
                      <Check size={15} />
                      {acting === item.approval.id ? "处理中…" : "批准并继续"}
                    </button>
                  </div>
                </>
              ) : (
                <div className="approval-resolved-note">
                  <StatusBadge status={item.approval.status} />
                  <span>{item.approval.note || "审批已处理"}</span>
                </div>
              )}
            </article>
          ))}
        </div>
      ) : (
        <article className="panel">
          <EmptyState
            icon={CheckCircle2}
            title="审批队列已清空"
            description="当前没有需要处理的敏感操作。新的审批请求会自动出现在这里。"
            action={
              <button className="button button--secondary" onClick={load}>
                <RefreshCw size={15} />
                刷新队列
              </button>
            }
          />
        </article>
      )}
    </>
  );
}

