type AgentMarkProps = {
  icon?: string;
  color?: string;
  size?: "sm" | "md" | "lg";
};

export function AgentMark({
  icon = "AF",
  color = "violet",
  size = "md"
}: AgentMarkProps) {
  return (
    <span className={`agent-mark agent-mark--${color} agent-mark--${size}`}>
      {icon.slice(0, 2)}
    </span>
  );
}

