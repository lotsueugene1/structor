/** Client-side reference content only. Structor's MCP service is not live yet. */
export type Integration = {
  id: string;
  name: string;
  category: string;
  description: string;
  configFile: string;
  configHint: string;
  steps: { title: string; description: string }[];
  docs: string;
};

// Setup details checked against the linked first-party documentation, 2026-09-19.
// These describe each client's remote HTTP support, not tested Structor connections.
export const integrations: Integration[] = [
  {
    id: "claude-code",
    name: "Claude Code",
    category: "Terminal agent",
    description:
      "Bring the reasoning behind your architecture into your terminal workflow.",
    configFile: ".mcp.json",
    configHint: "Project-scoped configuration · mcpServers → structor",
    steps: [
      {
        title: "Add a remote server",
        description:
          "Use Claude Code’s mcp add command with HTTP transport and project scope. Name the server structor.",
      },
      {
        title: "Use the published connection details",
        description:
          "Once Structor MCP launches, supply its endpoint and follow the released authentication instructions.",
      },
      {
        title: "Review in Claude Code",
        description:
          "Run /mcp to inspect the server and its available tools. Review permissions before allowing tool calls.",
      },
    ],
    docs: "https://code.claude.com/docs/en/mcp",
  },
  {
    id: "cursor",
    name: "Cursor",
    category: "AI code editor",
    description:
      "Keep system intent within reach as you work with Cursor Agent.",
    configFile: ".cursor/mcp.json",
    configHint: "Project configuration · mcpServers → structor → url",
    steps: [
      {
        title: "Open your project’s MCP config",
        description:
          "Create or open .cursor/mcp.json. Keep any servers you already use under mcpServers.",
      },
      {
        title: "Add Structor when available",
        description:
          "Add a structor entry with the published endpoint in its url field. Authentication details will accompany the MCP release.",
      },
      {
        title: "Review the available tools",
        description:
          "Open Cursor’s MCP settings, enable the server, and review which tools Agent can use.",
      },
    ],
    docs: "https://cursor.com/docs/mcp",
  },
  {
    id: "codex",
    name: "Codex",
    category: "Coding agent",
    description:
      "Give Codex the architectural context behind the code it is helping you build.",
    configFile: "~/.codex/config.toml",
    configHint: "User configuration · [mcp_servers.structor] → url",
    steps: [
      {
        title: "Open your MCP configuration",
        description:
          "Open config.toml and add a table named mcp_servers.structor. Keep your existing settings intact.",
      },
      {
        title: "Set the remote endpoint",
        description:
          "When Structor MCP is released, use its published address as url and follow its authentication instructions.",
      },
      {
        title: "Inspect the connection in Codex",
        description:
          "Use /mcp in the Codex terminal to review available servers and tools. OAuth sign-in, if required, uses codex mcp login structor.",
      },
    ],
    docs: "https://developers.openai.com/codex/mcp/",
  },
  {
    id: "copilot",
    name: "GitHub Copilot",
    category: "In VS Code",
    description:
      "Keep architecture decisions close to your Copilot agent sessions in VS Code.",
    configFile: ".vscode/mcp.json",
    configHint: "Workspace configuration · servers → structor · type: http",
    steps: [
      {
        title: "Add a server in VS Code",
        description:
          "Open the Command Palette and choose MCP: Add Server. Select HTTP and choose your configuration scope.",
      },
      {
        title: "Supply Structor’s endpoint",
        description:
          "When available, enter the published MCP URL and name the server structor. Use Structor’s released authentication instructions.",
      },
      {
        title: "Review trust and tools",
        description:
          "Review VS Code’s server trust prompt, then select the tools you want available in your Copilot agent session.",
      },
    ],
    docs: "https://code.visualstudio.com/docs/agent-customization/mcp-servers",
  },
  {
    id: "windsurf",
    name: "Windsurf",
    category: "Cascade agent",
    description:
      "Make the thinking behind your system available to Cascade as you code.",
    configFile: "~/.codeium/windsurf/mcp_config.json",
    configHint: "User configuration · mcpServers → structor → serverUrl",
    steps: [
      {
        title: "Open Cascade’s MCP settings",
        description:
          "Open the MCPs menu in the Cascade panel, then open the raw MCP configuration.",
      },
      {
        title: "Add the remote server",
        description:
          "Add structor under mcpServers. After release, set serverUrl to Structor’s published endpoint and configure authentication as instructed.",
      },
      {
        title: "Choose Cascade’s tools",
        description:
          "Open the server’s MCP settings to inspect and enable the tools you want Cascade to use.",
      },
    ],
    docs: "https://docs.windsurf.com/windsurf/cascade/mcp",
  },
  {
    id: "gemini",
    name: "Gemini CLI",
    category: "Terminal agent",
    description:
      "Carry requirements and system relationships into your Gemini CLI workflow.",
    configFile: ".gemini/settings.json",
    configHint: "Project configuration · mcpServers → structor → httpUrl",
    steps: [
      {
        title: "Open your Gemini settings",
        description:
          "Open .gemini/settings.json in your project and locate or add the mcpServers object.",
      },
      {
        title: "Configure Streamable HTTP",
        description:
          "Add a structor entry using httpUrl for the published endpoint once available. The url field is for legacy SSE, not Streamable HTTP.",
      },
      {
        title: "Review in the CLI",
        description:
          "Restart the session and use /mcp to inspect server status and tools. Follow Structor’s authentication guidance when it is released.",
      },
    ],
    docs: "https://geminicli.com/docs/tools/mcp-server/",
  },
  {
    id: "cline",
    name: "Cline",
    category: "Editor agent",
    description:
      "Put your system’s constraints and decisions in context for Cline.",
    configFile: "MCP Servers → Configure → Configure MCP Servers",
    configHint: "Extension configuration · type: streamableHttp · url",
    steps: [
      {
        title: "Open Remote Servers",
        description:
          "In Cline’s MCP Servers panel, choose the Remote Servers tab.",
      },
      {
        title: "Add Structor after release",
        description:
          "Name the server structor, choose Streamable HTTP, and enter the published endpoint. Authentication details are still to come.",
      },
      {
        title: "Review before approving",
        description:
          "Check the server’s discovered tools. Keep automatic approval off until you understand the access each tool needs.",
      },
    ],
    docs: "https://docs.cline.bot/mcp/mcp-overview",
  },
  {
    id: "continue",
    name: "Continue",
    category: "Editor agent",
    description:
      "Bring architectural intent into Continue’s agent mode without changing editors.",
    configFile: ".continue/mcpServers/structor.yaml",
    configHint: "Standalone YAML block · type: streamable-http · url",
    steps: [
      {
        title: "Create an MCP configuration block",
        description:
          "Add a YAML file inside .continue/mcpServers. Include the required name, version, and schema metadata.",
      },
      {
        title: "Add the remote transport",
        description:
          "Under mcpServers, add structor with type streamable-http. Use the endpoint and authentication instructions published at release.",
      },
      {
        title: "Switch to agent mode",
        description:
          "MCP tools are available in Continue’s agent mode. Inspect the tools and their permissions before use.",
      },
    ],
    docs: "https://docs.continue.dev/customize/deep-dives/mcp",
  },
  {
    id: "junie",
    name: "Junie",
    category: "JetBrains · CLI",
    description:
      "Keep the architecture behind your project in view while working with Junie.",
    configFile: ".junie/mcp/mcp.json",
    configHint: "Project configuration · mcpServers → structor → url",
    steps: [
      {
        title: "Open Junie’s MCP configuration",
        description:
          "In the Junie CLI terminal, use /mcp to open the server screen. Configurations can also be added in .junie/mcp/mcp.json.",
      },
      {
        title: "Add a remote server",
        description:
          "Choose a remote connection named structor. Use its published endpoint and authentication instructions when MCP becomes available.",
      },
      {
        title: "Review the server",
        description:
          "Use /mcp to inspect the configured server. If OAuth is required, select Authorize and follow the sign-in flow.",
      },
    ],
    docs: "https://junie.jetbrains.com/docs/junie-cli-mcp-configuration.html",
  },
];
