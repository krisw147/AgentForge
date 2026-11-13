import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { pathToFileURL } from "node:url";

const orders = {
  "ORD-2026-1042": {
    id: "ORD-2026-1042",
    customer: "陈嘉",
    product: "Aurel 降噪耳机",
    amount: 668,
    status: "已签收 · 2 天前",
    category: "electronics",
    refundable: true
  },
  "ORD-2026-0991": {
    id: "ORD-2026-0991",
    customer: "许言",
    product: "定制胡桃木书桌",
    amount: 2399,
    status: "已签收 · 4 天前",
    category: "custom",
    refundable: true
  },
  "ORD-2026-1088": {
    id: "ORD-2026-1088",
    customer: "赵语",
    product: "旅行收纳套装",
    amount: 329,
    status: "已发货 · 运输中",
    category: "accessories",
    refundable: true
  },
  "ORD-2026-1120": {
    id: "ORD-2026-1120",
    customer: "沈知",
    product: "智能台灯 Pro",
    amount: 899,
    status: "待发货",
    category: "electronics",
    refundable: true
  }
};

const policies = [
  {
    id: "standard-refund",
    title: "标准退款政策",
    content:
      "签收后 7 天内且商品未影响二次销售，可申请无理由退款。超过 500 元需要运营主管审批。"
  },
  {
    id: "special-refund",
    title: "特殊商品退款规则",
    content:
      "定制商品、生鲜和已激活电子产品原则上不支持无理由退款；质量问题需要人工复核。"
  },
  {
    id: "refund-sla",
    title: "退款时效",
    content:
      "审核通过后 1 个工作日内原路退款，到账时间以支付渠道为准。"
  }
];

export function createOrderMcpServer() {
  const server = new McpServer({
    name: "agentforge-order-server",
    version: "0.2.0"
  });

  server.registerTool(
  "get_order",
  {
    title: "查询订单",
    description: "根据订单号查询客户、商品、金额和当前状态。",
    inputSchema: {
      order_id: z.string().describe("订单号，例如 ORD-2026-1042")
    },
    annotations: {
      readOnlyHint: true
    }
  },
  async ({ order_id }) => {
    const order = orders[order_id.toUpperCase()];
    if (!order) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `未找到订单 ${order_id}`
          }
        ]
      };
    }
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(order)
        }
      ],
      structuredContent: order
    };
  }
);

  server.registerTool(
  "search_policy",
  {
    title: "检索退款政策",
    description: "按关键词检索退款规则、特殊商品和到账时效。",
    inputSchema: {
      query: z.string().describe("检索关键词")
    },
    annotations: {
      readOnlyHint: true
    }
  },
  async ({ query }) => {
    const normalized = query.toLowerCase();
    const matches = policies.filter((policy) =>
      `${policy.title}${policy.content}`.toLowerCase().includes(normalized)
    );
    const results = matches.length ? matches : policies.slice(0, 2);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(results)
        }
      ],
      structuredContent: { items: results }
    };
  }
);

  server.registerTool(
  "issue_refund",
  {
    title: "发起退款",
    description: "对符合条件的订单发起原路退款。该工具会改变资金状态。",
    inputSchema: {
      order_id: z.string(),
      amount: z.number().positive(),
      reason: z.string().min(2)
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true
    }
  },
  async ({ order_id, amount, reason }) => {
    const refundId = `RF-${Date.now().toString(36).toUpperCase()}`;
    const result = {
      refund_id: refundId,
      order_id,
      amount,
      reason,
      status: "processing",
      channel: "原支付渠道"
    };
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result)
        }
      ],
      structuredContent: result
    };
  }
);

  server.registerTool(
  "create_ticket",
  {
    title: "创建客服工单",
    description: "把无法自动处理的售后问题升级给人工客服。",
    inputSchema: {
      subject: z.string().min(2),
      priority: z.enum(["normal", "high"]).default("normal")
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false
    }
  },
  async ({ subject, priority }) => {
    const result = {
      ticket_id: `TK-${Date.now().toString(36).toUpperCase()}`,
      subject,
      priority,
      assignee: "售后支持组"
    };
    return {
      content: [{ type: "text", text: JSON.stringify(result) }],
      structuredContent: result
    };
  }
  );

  return server;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const server = createOrderMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("agentforge-order-server ready on stdio");
}


