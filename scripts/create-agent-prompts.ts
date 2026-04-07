/**
 * Prompt templates and output parsers for the create-agent wizard.
 */

/**
 * Build the Claude generation prompt for workspace markdown files.
 */
export function buildGenerationPrompt(name: string, description: string): string {
  return `You are helping configure a Claude Code agent for the claude-gateway multi-bot system.

The user described the agent as:
"""
${description}
"""

Generate workspace markdown files for this agent. Output each file as:

=== agent.md ===
<content here>

=== soul.md ===
<content here>

Rules:
- agent.md is REQUIRED. Start with "# Agent: ${name}" on line 1.
  Include: role, rules, what it can/cannot do, language to use.
  Always include this rule: when a message arrives, send a brief acknowledgement first
  (e.g. "Got it, let me check…" or "On it!"), then do the work and reply with the result.
- soul.md: tone and personality only (not rules). Omit if no distinct style.
- user.md: target user profile. Omit if public/unknown.
- tools.md: available tools or capabilities. Omit if none specified.
- heartbeat.md: only if proactive/scheduled tasks were described. Use YAML tasks format.
- bootstrap.md: only if a special first-run greeting is appropriate.
- Keep each file under 500 words.
- Omit files that are not relevant.`;
}

/**
 * Parse Claude's generated output into a Map of filename -> content.
 * Expects sections in the format:
 *   === filename.md ===
 *   <content here>
 */
export function parseGeneratedFiles(output: string): Map<string, string> {
  const files = new Map<string, string>();
  // Match sections starting with === filename ===
  const sectionRegex = /^=== ([^\s=][^=]*?) ===\s*$/gm;

  const matches: Array<{ filename: string; headerStart: number; contentStart: number }> = [];
  let match: RegExpExecArray | null;

  while ((match = sectionRegex.exec(output)) !== null) {
    const headerStart = match.index;
    const afterHeader = match.index + match[0].length;
    // Skip the newline immediately after the header line
    const contentStart = output[afterHeader] === '\n' ? afterHeader + 1 : afterHeader;
    matches.push({ filename: match[1].trim(), headerStart, contentStart });
  }

  for (let i = 0; i < matches.length; i++) {
    const { filename, contentStart } = matches[i];
    // Content ends at the start of the next section header (not mid-header)
    const contentEnd = i + 1 < matches.length ? matches[i + 1].headerStart : output.length;
    const content = output.slice(contentStart, contentEnd).trimEnd();

    if (content.length > 0) {
      files.set(filename, content);
    }
  }

  return files;
}
