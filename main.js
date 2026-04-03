/*
 * Claude Code - Obsidian Plugin
 *
 * Run Claude Code CLI on your notes from within Obsidian.
 * Requires `claude` CLI to be installed: https://docs.anthropic.com/en/docs/claude-code
 */

const obsidian = require("obsidian");
const { spawn, execSync } = require("child_process");
const path = require("path");
const fs = require("fs");

// ── Auto-detect claude binary ───────────────────────────────────────────────

function findClaudeBinary() {
	const home = process.env.HOME || "";

	// Common install locations
	const candidates = [
		path.join(home, ".local", "bin", "claude"),
		path.join(home, ".claude", "bin", "claude"),
		path.join(home, ".nvm", "versions", "node"),  // handled below
		"/usr/local/bin/claude",
		"/opt/homebrew/bin/claude",
		"/usr/bin/claude",
	];

	// Check straightforward paths first
	for (const p of candidates) {
		try {
			if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
		} catch (_) { /* skip */ }
	}

	// Check nvm — walk active node version's bin
	const nvmDir = path.join(home, ".nvm", "versions", "node");
	try {
		if (fs.existsSync(nvmDir)) {
			const versions = fs.readdirSync(nvmDir).sort().reverse();
			for (const v of versions) {
				const p = path.join(nvmDir, v, "bin", "claude");
				if (fs.existsSync(p)) return p;
			}
		}
	} catch (_) { /* skip */ }

	// Last resort: ask a login shell (slower but handles custom setups)
	try {
		const shell = process.env.SHELL || "/bin/zsh";
		const result = execSync(`${shell} -ilc "which claude" 2>/dev/null`, {
			timeout: 5000,
			encoding: "utf-8",
		}).trim();
		if (result && fs.existsSync(result)) return result;
	} catch (_) { /* skip */ }

	return null;
}

// ── Default settings ────────────────────────────────────────────────────────

const DEFAULT_SETTINGS = {
	claudePath: "",      // empty = auto-detect
	model: "",           // empty = CLI default
	outputMode: "modal", // "modal" | "append" | "replace-selection"
	agentMode: "off",    // "off" | "tools" | "full"
	customTasks: [],     // user-defined tasks [{name, prompt}]
};

// ── System prompt ───────────────────────────────────────────────────────────

const SYSTEM_PROMPT = [
	"You are an assistant integrated into Obsidian, a markdown-based knowledge management app.",
	"The user is working on a note in their Obsidian vault. They will give you the note's content and a task to perform.",
	"",
	"Important guidelines:",
	"- Your output will be used to directly modify or replace the user's note, so respond with the final content only — no wrapping explanation unless the task explicitly asks for commentary.",
	"- Preserve the note's existing markdown formatting (headings, lists, links, tags, frontmatter, etc.) unless the task requires changing it.",
	"- Obsidian uses [[wikilinks]] and #tags — keep these intact.",
	"- If the user selected only part of the note, your response replaces just that selection.",
	"- Be concise. Do not add preamble like \"Here is the revised note:\" — just return the content.",
].join("\n");

const MODELS = [
	{ value: "",                            label: "Default (CLI default)" },
	{ value: "claude-opus-4-6",             label: "Claude Opus 4.6" },
	{ value: "claude-sonnet-4-6",           label: "Claude Sonnet 4.6" },
	{ value: "claude-haiku-4-5-20251001",   label: "Claude Haiku 4.5" },
];

// ── Built-in tasks ──────────────────────────────────────────────────────────

const BUILTIN_TASKS = [
	{
		id: "summarize",
		name: "Summarize note",
		prompt: "Summarize the following note concisely. Preserve key information and structure.\n\n",
	},
	{
		id: "explain",
		name: "Explain note",
		prompt: "Explain the content of this note in plain language. Break down any complex concepts.\n\n",
	},
	{
		id: "review",
		name: "Review & suggest improvements",
		prompt: "Review this note for clarity, accuracy, and completeness. Suggest specific improvements.\n\n",
	},
	{
		id: "action-items",
		name: "Extract action items",
		prompt: "Extract all action items, TODOs, and next steps from this note. Return them as a markdown checklist.\n\n",
	},
	{
		id: "fix-grammar",
		name: "Fix grammar & spelling",
		prompt: "Fix any grammar, spelling, and punctuation errors in this note. Return the corrected text only, preserving all formatting.\n\n",
	},
	{
		id: "eli5",
		name: "ELI5 (Explain like I'm 5)",
		prompt: "Explain the content of this note as if you were explaining it to a five-year-old.\n\n",
	},
];

// ── Helpers ─────────────────────────────────────────────────────────────────

function getActiveFileContent(app) {
	const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView);
	if (!view) return null;

	const editor = view.editor;
	const selection = editor.getSelection();
	return {
		content: selection || editor.getValue(),
		isSelection: !!selection,
		file: view.file,
		editor,
	};
}

// ── Claude runner ───────────────────────────────────────────────────────────

function resolvePath(claudePath) {
	if (claudePath && claudePath.trim()) {
		return claudePath.replace(/^~/, process.env.HOME || "");
	}
	const detected = findClaudeBinary();
	if (!detected) {
		throw new Error(
			"Could not find claude CLI. Install it with: npm install -g @anthropic-ai/claude-code\n" +
			"Or set the path manually in Settings → Claude Code."
		);
	}
	return detected;
}

function runClaude(claudePath, model, systemPrompt, prompt, cwd, agentMode) {
	return new Promise((resolve, reject) => {
		let stdout = "";
		let stderr = "";

		let resolved;
		try {
			resolved = resolvePath(claudePath);
		} catch (err) {
			return reject(err);
		}

		const args = [
			"-p",
			"--output-format", "text",
			"--system-prompt", systemPrompt,
		];

		if (agentMode === "full") {
			// Full agent: all tools, skip permission prompts
			args.push("--dangerously-skip-permissions");
		} else if (agentMode === "tools") {
			// Tools enabled but permissions still required
			// (user confirms each action in the terminal)
		} else {
			// Text-only: no tools, no MCP
			args.push("--tools", "", "--strict-mcp-config");
		}

		if (model) args.push("--model", model);

		const proc = spawn(resolved, args, {
			cwd,
			env: { ...process.env, NO_COLOR: "1" },
		});

		proc.stdin.write(prompt);
		proc.stdin.end();

		proc.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
		proc.stderr.on("data", (chunk) => { stderr += chunk.toString(); });

		proc.on("error", (err) => reject(new Error(`Failed to start claude: ${err.message}`)));

		proc.on("close", (code) => {
			if (code === 0) {
				resolve(stdout.trim());
			} else {
				reject(new Error(stderr.trim() || `claude exited with code ${code}`));
			}
		});
	});
}

// ── Output modal ────────────────────────────────────────────────────────────

class ClaudeOutputModal extends obsidian.Modal {
	constructor(app, title, ctx) {
		super(app);
		this.title = title;
		this.ctx = ctx; // { editor, isSelection, file }
		this.result = "";
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.addClass("claude-code-modal");

		contentEl.createEl("h2", { text: this.title });
		this.outputEl = contentEl.createDiv({ cls: "claude-code-output" });
		this.outputEl.createDiv({ cls: "claude-code-spinner", text: "Running claude..." });
	}

	setContent(text) {
		this.result = text;
		this.outputEl.empty();
		obsidian.MarkdownRenderer.render(this.app, text, this.outputEl, "", null);

		const actions = this.contentEl.createDiv({ cls: "claude-code-actions" });

		// Copy
		const copyBtn = actions.createEl("button", { text: "Copy" });
		copyBtn.addEventListener("click", () => {
			navigator.clipboard.writeText(this.result);
			new obsidian.Notice("Copied to clipboard");
		});

		// Replace selection (only if there was a selection)
		if (this.ctx && this.ctx.isSelection) {
			const replaceSelBtn = actions.createEl("button", { text: "Replace selection" });
			replaceSelBtn.addEventListener("click", () => {
				this.ctx.editor.replaceSelection(this.result);
				new obsidian.Notice("Selection replaced");
				this.close();
			});
		}

		// Replace entire note
		if (this.ctx) {
			const replaceBtn = actions.createEl("button", { text: "Replace note" });
			replaceBtn.addEventListener("click", () => {
				this.ctx.editor.setValue(this.result);
				new obsidian.Notice("Note replaced");
				this.close();
			});

			// Append to note
			const appendBtn = actions.createEl("button", { text: "Append to note" });
			appendBtn.addEventListener("click", () => {
				const current = this.ctx.editor.getValue();
				this.ctx.editor.setValue(current + "\n\n---\n\n" + this.result + "\n");
				new obsidian.Notice("Appended to note");
				this.close();
			});
		}
	}

	setError(msg) {
		this.outputEl.empty();
		this.outputEl.createEl("p", {
			text: `Error: ${msg}`,
			attr: { style: "color: var(--text-error);" },
		});
	}

	onClose() {
		this.contentEl.empty();
	}
}

// ── Custom prompt modal ─────────────────────────────────────────────────────

class ClaudePromptModal extends obsidian.Modal {
	constructor(app, onSubmit) {
		super(app);
		this.onSubmit = onSubmit;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.addClass("claude-code-modal");
		contentEl.createEl("h2", { text: "Claude Code — Custom Prompt" });

		contentEl.createEl("p", {
			text: "Enter your prompt. The current note (or selection) will be appended automatically.",
			attr: { style: "color: var(--text-muted); font-size: 0.85em;" },
		});

		const textarea = contentEl.createEl("textarea", { cls: "claude-code-prompt-input" });
		textarea.placeholder = "e.g. Translate this to French...";
		textarea.focus();

		const actions = contentEl.createDiv({ cls: "claude-code-actions" });
		const submitBtn = actions.createEl("button", { text: "Run", cls: "mod-cta" });

		const submit = () => {
			const value = textarea.value.trim();
			if (value) {
				this.close();
				this.onSubmit(value);
			}
		};

		submitBtn.addEventListener("click", submit);
		textarea.addEventListener("keydown", (e) => {
			if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
				e.preventDefault();
				submit();
			}
		});
	}

	onClose() {
		this.contentEl.empty();
	}
}

// ── Settings tab ────────────────────────────────────────────────────────────

class ClaudeCodeSettingTab extends obsidian.PluginSettingTab {
	constructor(app, plugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display() {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl("h2", { text: "Claude Code Settings" });

		const detected = findClaudeBinary();
		new obsidian.Setting(containerEl)
			.setName("Claude CLI path")
			.setDesc(
				detected
					? `Leave empty to auto-detect. Found: ${detected}`
					: "Auto-detect failed — please enter the full path to claude."
			)
			.addText((text) =>
				text
					.setPlaceholder(detected || "/path/to/claude")
					.setValue(this.plugin.settings.claudePath)
					.onChange(async (value) => {
						this.plugin.settings.claudePath = value;
						await this.plugin.saveSettings();
					})
			);

		new obsidian.Setting(containerEl)
			.setName("Model")
			.setDesc("Which Claude model to use.")
			.addDropdown((dropdown) => {
				for (const m of MODELS) dropdown.addOption(m.value, m.label);
				dropdown
					.setValue(this.plugin.settings.model)
					.onChange(async (value) => {
						this.plugin.settings.model = value;
						await this.plugin.saveSettings();
					});
			});

		new obsidian.Setting(containerEl)
			.setName("Agent mode")
			.setDesc("Controls whether Claude can read/edit files in your vault directly.")
			.addDropdown((dropdown) =>
				dropdown
					.addOption("off", "Off — text response only")
					.addOption("tools", "Tools enabled — asks permission for each action")
					.addOption("full", "Full agent — skip all permission prompts")
					.setValue(this.plugin.settings.agentMode)
					.onChange(async (value) => {
						this.plugin.settings.agentMode = value;
						await this.plugin.saveSettings();
					})
			);

		new obsidian.Setting(containerEl)
			.setName("Output mode")
			.setDesc("Where to show Claude's response.")
			.addDropdown((dropdown) =>
				dropdown
					.addOption("modal", "Show in modal")
					.addOption("append", "Append to note")
					.addOption("replace-selection", "Replace selection")
					.setValue(this.plugin.settings.outputMode)
					.onChange(async (value) => {
						this.plugin.settings.outputMode = value;
						await this.plugin.saveSettings();
					})
			);

		// ── Custom tasks ──
		containerEl.createEl("h3", { text: "Custom Tasks" });
		containerEl.createEl("p", {
			text: "Define reusable prompts that show up in the command palette.",
			attr: { style: "color: var(--text-muted); font-size: 0.85em; margin-top: -0.5em;" },
		});

		const tasksContainer = containerEl.createDiv();
		this.renderCustomTasks(tasksContainer);
	}

	renderCustomTasks(container) {
		container.empty();

		this.plugin.settings.customTasks.forEach((task, index) => {
			const s = new obsidian.Setting(container)
				.setName(task.name || "(unnamed)")
				.setDesc(task.prompt.substring(0, 80) + (task.prompt.length > 80 ? "…" : ""));

			s.addButton((btn) =>
				btn.setButtonText("Edit").onClick(() => {
					const modal = new CustomTaskEditModal(this.app, task, async (updated) => {
						this.plugin.settings.customTasks[index] = updated;
						await this.plugin.saveSettings();
						this.plugin.registerCustomTaskCommands();
						this.renderCustomTasks(container);
					});
					modal.open();
				})
			);

			s.addButton((btn) =>
				btn
					.setButtonText("Delete")
					.setWarning()
					.onClick(async () => {
						this.plugin.settings.customTasks.splice(index, 1);
						await this.plugin.saveSettings();
						this.plugin.registerCustomTaskCommands();
						this.renderCustomTasks(container);
					})
			);
		});

		new obsidian.Setting(container).addButton((btn) =>
			btn.setButtonText("Add task").setCta().onClick(() => {
				const modal = new CustomTaskEditModal(this.app, { name: "", prompt: "" }, async (task) => {
					this.plugin.settings.customTasks.push(task);
					await this.plugin.saveSettings();
					this.plugin.registerCustomTaskCommands();
					this.renderCustomTasks(container);
				});
				modal.open();
			})
		);
	}
}

// ── Custom task editor modal ────────────────────────────────────────────────

class CustomTaskEditModal extends obsidian.Modal {
	constructor(app, task, onSave) {
		super(app);
		this.task = { ...task };
		this.onSave = onSave;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.createEl("h2", { text: "Edit Custom Task" });

		new obsidian.Setting(contentEl)
			.setName("Name")
			.setDesc("Shows in the command palette.")
			.addText((t) =>
				t.setValue(this.task.name).onChange((v) => (this.task.name = v))
			);

		contentEl.createEl("label", { text: "Prompt", attr: { style: "font-weight: 600;" } });
		const textarea = contentEl.createEl("textarea", { cls: "claude-code-prompt-input" });
		textarea.value = this.task.prompt;
		textarea.addEventListener("input", () => (this.task.prompt = textarea.value));

		const actions = contentEl.createDiv({ cls: "claude-code-actions" });
		actions.createEl("button", { text: "Save", cls: "mod-cta" }).addEventListener("click", () => {
			if (this.task.name.trim() && this.task.prompt.trim()) {
				this.close();
				this.onSave(this.task);
			} else {
				new obsidian.Notice("Both name and prompt are required.");
			}
		});
	}

	onClose() {
		this.contentEl.empty();
	}
}

// ── Main plugin ─────────────────────────────────────────────────────────────

class ClaudeCodePlugin extends obsidian.Plugin {
	async onload() {
		await this.loadSettings();
		this.customCommandIds = [];

		// Register built-in task commands
		for (const task of BUILTIN_TASKS) {
			this.addCommand({
				id: `claude-${task.id}`,
				name: task.name,
				editorCallback: () => this.runTask(task.prompt, task.name),
			});
		}

		// Custom prompt command
		this.addCommand({
			id: "claude-custom-prompt",
			name: "Custom prompt…",
			editorCallback: () => {
				new ClaudePromptModal(this.app, (prompt) => {
					this.runTask(prompt + "\n\n", "Custom prompt");
				}).open();
			},
		});

		// Register user-defined task commands
		this.registerCustomTaskCommands();

		// Settings tab
		this.addSettingTab(new ClaudeCodeSettingTab(this.app, this));

		console.log("Claude Code plugin loaded");
	}

	onunload() {
		console.log("Claude Code plugin unloaded");
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	registerCustomTaskCommands() {
		// Unload old custom commands — Obsidian doesn't expose a clean
		// removeCommand API, so we track IDs and skip duplicates.
		// Commands persist until the plugin is reloaded, but that's fine
		// because we use stable IDs derived from the task name.
		this.customCommandIds = [];

		for (const task of this.settings.customTasks) {
			const id = `claude-custom-${task.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
			if (this.customCommandIds.includes(id)) continue;

			this.addCommand({
				id,
				name: `Custom: ${task.name}`,
				editorCallback: () => this.runTask(task.prompt + "\n\n", task.name),
			});
			this.customCommandIds.push(id);
		}
	}

	async runTask(promptPrefix, taskName) {
		const ctx = getActiveFileContent(this.app);
		if (!ctx) {
			new obsidian.Notice("Open a markdown file first.");
			return;
		}

		const filePath = ctx.file ? ctx.file.path : "unknown";
		const vaultName = this.app.vault.getName();
		const vaultPath = this.app.vault.adapter.basePath;

		const agentic = this.settings.agentMode !== "off";
		const systemPrompt = SYSTEM_PROMPT
			+ `\n\nCurrent file: ${filePath}`
			+ `\nVault: ${vaultName}`
			+ `\nVault path on disk: ${vaultPath}`
			+ (ctx.isSelection ? "\nThe user has selected a portion of the note. Your output replaces the selection only." : "")
			+ (agentic
				? "\n\nYou have file editing tools available. You may read and edit files directly in the vault when the task requires it. The vault root is the working directory."
				: "");

		const fullPrompt = `Task: ${promptPrefix}`
			+ `\n---\n${ctx.isSelection ? "Selected text" : "Full note content"}:\n\n`
			+ ctx.content;

		// Decide how to output
		const mode = this.settings.outputMode;

		if (mode === "modal") {
			const modal = new ClaudeOutputModal(this.app, `Claude — ${taskName}`, ctx);
			modal.open();

			try {
				const result = await runClaude(this.settings.claudePath, this.settings.model, systemPrompt, fullPrompt, vaultPath, this.settings.agentMode);
				modal.setContent(result);
			} catch (err) {
				modal.setError(err.message);
			}
		} else {
			new obsidian.Notice(`Running Claude: ${taskName}…`);

			try {
				const result = await runClaude(this.settings.claudePath, this.settings.model, systemPrompt, fullPrompt, vaultPath, this.settings.agentMode);

				if (mode === "replace-selection" && ctx.isSelection) {
					ctx.editor.replaceSelection(result);
				} else {
					// Append
					const current = ctx.editor.getValue();
					const separator = "\n\n---\n\n";
					const header = `## Claude — ${taskName}\n\n`;
					ctx.editor.setValue(current + separator + header + result + "\n");
				}

				new obsidian.Notice("Claude finished.");
			} catch (err) {
				new obsidian.Notice(`Claude error: ${err.message}`);
			}
		}
	}
}

module.exports = ClaudeCodePlugin;
