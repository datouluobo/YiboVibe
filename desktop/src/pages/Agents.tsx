// Agents page - shows running agent sessions and host status

function Agents() {
  return (
    <div>
      <h2 style={{ marginBottom: 16, fontSize: 18, fontWeight: 600 }}>Agents</h2>
      <p style={{ color: "var(--color-text-muted)", fontSize: 13 }}>
        Agent sessions running on this host.
      </p>
    </div>
  );
}

export default Agents;
