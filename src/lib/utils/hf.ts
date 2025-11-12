// Client-safe HF utilities used in UI components

export function isStrictHfMcpLogin(urlString: string): boolean {
  try {
    const u = new URL(urlString);
    return (
      u.protocol === "https:" &&
      u.hostname === "huggingface.co" &&
      u.pathname === "/mcp" &&
      u.search === "?login"
    );
  } catch {
    return false;
  }
}

