/**
 * 自测：拿一份真实的 PTC 系统提示词快照验证 cangjie-zh 的翻译覆盖率与纪律注入。
 *
 * 用法：node self-test.mjs [system-prompt.md]
 *   不给参数时用下面的内置样本（真实提示词的英文原文，够验证脚本自身）；
 *   给一份快照时按空行切块模拟 section，跑一遍汉化，然后列出**仍为英文的行**——
 *   剩下应当只有 TypeScript 类型声明与枚举字面量。
 *
 * 除了覆盖率，本脚本还守住三条纪律（见文中三处注释）：
 *   1. section 数量只能多出末尾的批量引导段——身份段走按名注入，不该落到"补一段"的兜底分支；
 *      批量引导只有 PTC 一套文案（本包只管 PTC），末尾段的位置与归属都在这里守；
 *   2. 会被 harness 插值的 section 里不许留下未注册变量（否则整份组装抛错、会话不可用）；
 *   3. 系统提示词必须与工作目录无关——换目录后 sections 与 tools 逐字节相同（缓存契约）。
 * 命中其中任何一条，脚本以非 0 退出码结束。
 *
 * 快照从哪来：**0.2.1-alpha.2 起，会话日志不再记录系统提示词**——`request/header`
 * 事件的 `data.header` 只有 `config`、`adapterDefaults`、`tools`（实测 7/7 全无
 * `system`），所以旧版注释里那句"从 session.jsonl.zstd 取 data.header.system"已经失效。
 * 需要真快照时请自己导出：从 GUI 复制提示词，或按 section 名拼一份；本脚本不依赖
 * 网络或运行时。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// 与脚本同目录解析，不再依赖某台机器上的绝对路径。
const PLUGIN = new URL('./cangjie-zh.mjs', import.meta.url)
const src = process.argv[2]

// 内置样本：每段都是 PROSE 表里的**真实英文原文**，用空行分开以模拟独立 section。
const BUILTIN = `You are an AI agent powered by DeepSeek Harness.

Tokens prefixed with @ are workspace paths the user explicitly referenced, relative to the workspace root. A trailing slash marks a directory: list it when its contents matter. Anything else is a file: use the read tool when its contents are needed, and do not claim to have inspected it before reading. @"..." quotes a path containing spaces.

Use the read tool — not shell commands like cat — to inspect text files. Results include line numbers. Use offset and limit to continue reading large files.

\`run_code\` takes two required arguments: \`description\`, a short summary of what the program does, and \`code\` — the body of an async TypeScript function (erasable syntax only — no \`enum\` or namespaces; type annotations are advisory, the code runs type-stripped). The declarations below are SDK bindings for this program. A declaration does not make its name a directly callable tool; only names supplied as separate tool schemas may be called directly.`

const mod = await import(PLUGIN.href)
if (typeof mod.apply !== 'function') throw new Error('apply 未导出')

let handler
let stepHandler
const ctx = {
	on: (event, fn) => {
		if (event === 'system-prompt/assemble') handler = fn
		// 技能目录不经过 assemble：它以 <system-reminder> 形式注入 user 消息，走这条监听。
		if (event === 'agent/pre-step') stepHandler = fn
	},
}
mod.apply(ctx)
if (handler === undefined) throw new Error('未注册 system-prompt/assemble 监听')
if (stepHandler === undefined) throw new Error('未注册 agent/pre-step 监听')

const raw = src === undefined ? BUILTIN : fs.readFileSync(src, 'utf8')
console.log(src === undefined ? '输入：内置样本' : '输入：' + src)

/** 身份段的英文原文，与 cangjie-zh.mjs 的 `IDENTITY_EN` 必须一致。 */
const IDENTITY_EN = 'You are an AI agent powered by DeepSeek Harness.'

// 按空行切块，模拟独立 section；代码块内部无空行，保持完整。
const chunks = raw.split(/\n{2,}/).filter(c => c.trim().length > 0)
// 身份段在真实组装里的名字是 `harness:identity`（`dsh-system-prompt` 的常量）。按名认它，
// 才能走到 cangjie-zh 的按名注入分支；否则会落到"在最前面补一段"的兜底路径，section 数量
// 变化，下面那条断言就会误报。
const sections = chunks.map((text, i) => ({
	name: text.includes(IDENTITY_EN) ? 'harness:identity' : `chunk-${i}`,
	text,
}))
const cwd = process.cwd()
/** 真实组装里的工作目录上下文：名字与形状见 `dsh-working-directory` 的 `contextText()`。 */
const workdirContext = directory => ({ name: 'working-directory:current', text: `Current working directory: ${JSON.stringify(directory)}.`, interpolate: false })
const contexts = [
	// 工作目录是**运行时上下文**（会进用户消息），不是提示词变量，也**不再**进身份段：
	// 身份段必须与它无关，否则系统提示词会随项目目录变化。
	workdirContext(cwd),
	{ name: 'sandbox:policy', text: 'Current DSH file policy: danger-full-access. The DSH file sandbox does not restrict file modifications by available operations.' },
	{ name: 'approval:policy', text: 'Approval prompts are disabled in this session: actions that require approval are rejected automatically — do not request sandbox escalation (do not set `sandbox_permissions`).' },
]
const tools = [{
	name: 'run_code',
	description: 'Execute a TypeScript program against the available tools. Takes two required arguments: `description`, a short summary of what the program does, and `code`, the BODY of an async function (erasable syntax only; top-level `await` and `return` work). Call tools as `await tools.name(args)` per the declarations in the system prompt. Only what you print or return is program output — curate it. Image-bearing subtool results are attached after the run.',
	parameters: {
		type: 'object',
		properties: {
			code: { type: 'string', required: true, description: 'The program: the body of an async TypeScript function.' },
			description: { type: 'string', required: true, description: 'Clear, concise description of what this program does in active voice, 5-10 words (shown in the UI). Provide `description` before `code` in the arguments. Examples: "Count TODO markers across packages"; "Read failing test and its fixture"; "Rename config key in every cordis.yml".' },
		},
		required: ['code', 'description'],
		additionalProperties: false,
	},
}]

// 变量表按真实组装的现状给：0.2.1-alpha.2 里只剩 provider 与 model，`cwd` 已经不在了。
const variables = { provider: 'deepseek', model: 'deepseek-flash' }
/** 用指定工具目录跑一次组装。 */
const assembleWith = async (toolList, workdir = cwd) => handler(null, null, async () => ({
	sections,
	contexts: [workdirContext(workdir), ...contexts.slice(1)],
	tools: toolList,
	variables,
}))
/** 用指定工作目录跑一次组装：身份段不该因此有任何变化。 */
const assemble = async (workdir = cwd) => assembleWith(tools, workdir)
const out = await assemble()
// 组装结果应当比输入多出**一段**：`cangjie:batch-calls`（批量引导），而且必须在末尾——
// 它是整份系统提示词的末段（见 cangjie-zh.mjs 的 appendBatchSection）。
if (out.sections.length !== sections.length + 1) throw new Error('section 数量不正确：应当只多出末尾的批量引导段')
const batchSection = out.sections[out.sections.length - 1]
if (batchSection?.name !== 'cangjie:batch-calls') throw new Error('批量引导不在系统提示词末尾（最后一段是 ' + batchSection?.name + '）')
if (batchSection.interpolate !== false) throw new Error('批量引导段没有钉 interpolate: false')

const text = out.sections.map(s => s.text).join('\n\n')
const ctxText = out.contexts.map(c => c.text).join('\n\n')

// 未注册变量检查——照 harness 的规则复查一遍（`dsh-system-prompt` 的 `interpolate()`）：
// 被渲染的 section 里出现一个变量表里没有的 `{{name}}`，或者名字不合 `[a-z][a-z0-9_]*`，
// 渲染器都会**抛错**，整份系统提示词组装失败、这一轮会话完全不可用。这类故障在真实运行里
// 没有任何降级，所以自测必须自己抓住它：标记 `interpolate: false` 的 section 按 harness
// 的规则跳过。
const VARIABLE_NAME = /^[a-z][a-z0-9_]*$/
const variableProblems = []
for (const section of out.sections) {
	if (section.interpolate === false) continue
	for (const matched of String(section.text).matchAll(/\{\{([^{}]*)\}\}/g)) {
		const name = matched[1]
		if (!VARIABLE_NAME.test(name)) variableProblems.push(`${section.name}: "{{${name}}}" 不是合法的变量名`)
		else if (!(name in variables)) variableProblems.push(`${section.name}: "{{${name}}}" 未注册（注册变量：${Object.keys(variables).join(', ')}）`)
	}
}

// 身份段断言：中文正文必须真的落进 `harness:identity`，且**与环境无关**。
const identity = out.sections.find(section => section.name === 'harness:identity')
if (identity === undefined) {
	console.log(`提示：输入里没有英文身份段（${IDENTITY_EN}），跳过身份段断言——这份快照可能已经是译文。`)
} else {
	if (identity.interpolate !== false) throw new Error('身份段没有钉 interpolate: false')
	// 「缓存契约」：身份段位于系统提示词最前面（order -1000），一旦嵌了工作目录这类环境值，
	// 每个项目目录都会得到一份不同的系统提示词，前缀缓存从第一个变化的 token 起全部失效。
	// 工作目录由 runtime 上下文（用户消息）携带，不需要也不应该写进身份段。
	if (identity.text.includes(cwd)) throw new Error('身份段里嵌了工作目录，系统提示词会随项目变化：' + cwd)
	if (identity.text.includes('{{')) throw new Error('身份段里留下了提示词变量占位符')
	if (!identity.text.includes('行动规范')) throw new Error('身份段没有注入行为纪律')
	// 「批量化调用」引导**不在身份段里**：它被追加到系统提示词最后一段
	// （见 cangjie-zh.mjs 的 appendBatchSection）。身份段只留行动规范、破坏性操作授权、提问纪律。
	const DISCIPLINE_MARKERS = ['行动规范', '破坏性操作需要先获得用户授权', '遇事不决就提问']
	for (const marker of DISCIPLINE_MARKERS) {
		if (!identity.text.includes(marker)) throw new Error('身份段缺少纪律小节：' + marker)
	}
	if (identity.text.includes('批量化调用工具')) throw new Error('身份段里还留着批量引导，它应该只在末尾段')
}

// 末尾段的文案：本包只服务 PTC（`run_code` 是唯一可直接调用的工具），所以只有一套文案。
// 它必须还是"写进同一个程序、用 run_code"那套——标准模式（在一个 assistant 消息里发多个调用）
// 属于雅言（`dsh-yayan-preset`），本包不维护、也不该出现那套措辞。
if (!batchSection.text.includes('run_code')) {
	throw new Error('末尾的批量引导没有提到 run_code，不是 PTC 版文案')
}
if (batchSection.text.includes('同一个 assistant 消息')) {
	throw new Error('末尾的批量引导混进了标准模式的措辞，那属于雅言包')
}
console.log('批量引导：PTC 单套文案，在系统提示词末尾')

// 残留英文检测：一行里出现 4 个及以上连续 ASCII 单词，且不含中文。
const CJK = /[\u4e00-\u9fff]/
const latinLines = []
for (const line of (text + '\n' + ctxText).split('\n')) {
	if (CJK.test(line)) continue
	const words = line.match(/[A-Za-z][A-Za-z'-]*/g) ?? []
	if (words.length >= 5) latinLines.push(line.trim())
}

console.log('sections:', out.sections.length)
console.log('run_code.description:', out.tools[0].description.slice(0, 60), '…')
console.log('run_code.parameters.code.description:', out.tools[0].parameters.properties.code.description)
console.log('contexts:', out.contexts.map(c => c.text).join(' | '))
console.log('')
console.log('=== 仍为英文的行（' + latinLines.length + '）===')
for (const l of latinLines) console.log(l.slice(0, 200))

const outFile = path.join(os.tmpdir(), 'ptc-real', 'translated.md')
fs.mkdirSync(path.dirname(outFile), { recursive: true })
fs.writeFileSync(outFile, text)
console.log('')
console.log('译文已写入 ' + outFile)

if (variableProblems.length > 0) {
	console.log('')
	console.log('=== 会让组装失败的提示词变量（' + variableProblems.length + '）===')
	for (const problem of variableProblems) console.log(problem)
	console.log('这些 section 文本必须先把占位符换成真实值，或整段改用 interpolate: false。')
	process.exitCode = 1
} else {
	console.log('')
	console.log('未注册变量检查：通过')
}

// ── 技能目录（`agent/pre-step` 路径）与幂等性 ────────────────────────────────
// 技能目录不经过 assemble：它以 `<system-reminder>` 注入 user 消息。**它的重发判定与文本无关**
// ——`dsh-tool-skill` 用 entries 的结构化 digest 决定是否注入（相同摘要时反而把目录消息从本轮
// 摘掉），本插件只换文本、保留 message id 与 source，所以翻译不会让目录每个 step 重发。
// 这里再守住另一件事：改写必须**幂等**，否则落地文本会漂移、前缀缓存跟着失效。
const OFFICE_SKILLS = [
	{ name: 'office', description: 'Create, edit, inspect, or convert Office documents, spreadsheets, presentations, and PDFs. Load to choose the relevant workflow.' },
	{ name: 'office-docx', description: 'Create, read, edit, and validate Word documents (.docx).' },
	{ name: 'office-xlsx', description: 'Read, create, edit, and validate Excel workbooks, data, and formulas (.xlsx).' },
]
const CATALOG = [
	'<system-reminder>',
	'A skill is a reusable set of task-specific instructions. The following skills are available in this session:',
	'',
	'<available_skills>',
	...OFFICE_SKILLS.map(skill => '- `' + skill.name + '`: ' + skill.description),
	'</available_skills>',
	'',
	'</system-reminder>',
].join('\n')

const runStep = async text => {
	const decision = await stepHandler(null, async () => ({
		kind: 'continue',
		messages: [{ id: 'm1', role: 'user', content: [{ type: 'text', text }], source: { kind: 'skill-catalog', form: 'catalog' } }],
	}))
	return decision.messages[0].content[0].text
}
const catalogOnce = await runStep(CATALOG)
const catalogTwice = await runStep(catalogOnce)
if (catalogOnce === CATALOG) throw new Error('技能目录没有被翻译')
if (!catalogOnce.includes('技能是一组可复用的')) throw new Error('技能目录的引导句没有翻译')
if (catalogTwice !== catalogOnce) throw new Error('技能目录翻译不幂等：第二次又改动了')
const untranslatedSkills = OFFICE_SKILLS.filter(skill => catalogOnce.includes(skill.description))
if (untranslatedSkills.length > 0) throw new Error('office 技能的描述没被翻译：' + untranslatedSkills.map(skill => skill.name).join(', '))
console.log('技能目录：已翻译，且幂等（message id 与 source 不变，不会引起重发）；office 描述已汉化')

// 系统提示词侧同样要求幂等：同一份输入连跑两次必须逐字相同，否则每个 step 的前缀都会变。
const second = await assemble()
if (JSON.stringify(second) !== JSON.stringify(out)) throw new Error('系统提示词翻译不幂等：两次结果不同')
console.log('系统提示词：翻译幂等（同一输入两次结果逐字相同）')

// ── 缓存契约：环境无关性 ─────────────────────────────────────────────────────
// 换一个工作目录重新组装，系统提示词（sections + tools）必须逐字节相同。这条断言直接挡住
// "身份段里嵌工作目录"这类回归——那会让每个项目各有一份提示词，前缀缓存从第一个变化的
// token 起全部失效。注意只比较 sections/tools：工作目录本身属于**上下文**（用户消息），
// 它本来就该跟着会话走。
const otherCwd = process.platform === 'win32' ? 'D:\\another\\project' : '/home/someone/another-project'
const elsewhere = await assemble(otherCwd)
if (JSON.stringify([elsewhere.sections, elsewhere.tools]) !== JSON.stringify([out.sections, out.tools])) {
	throw new Error('系统提示词随工作目录变化：身份段里还有环境相关文本')
}
console.log('环境无关性：换工作目录（' + otherCwd + '）后，sections 与 tools 逐字节相同')
