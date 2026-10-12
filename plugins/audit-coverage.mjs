/**
 * 覆盖率审计：拿 DSH 源码里的"当前英文原文"逐条实测本插件的翻译。
 *
 * 用法：node audit-coverage.mjs <DSH 源码根目录>
 *   例如：node audit-coverage.mjs "E:\Study\typescript\deepseek-harness"
 *   也可用环境变量 DSH_CHECKOUT 指定；不给就报错退出。
 *
 * 它做三件事（全部只读，不改任何源码）：
 *   1. 扫 `packages/<组>/<包>/src/**`，折叠 `'a' + 'b'` 拼接后抽出会进入提示词的英文长句
 *      （`systemPrompt.section({ text })`、`defineTool({ description })` 及其参数描述）；
 *   2. 扫随附技能的 `SKILL.md` 描述、以及 `tool-skill` 里的技能目录散文；
 *   3. 把每一条喂给**本插件自己的翻译路径**——前一类走 `system-prompt/assemble`，
 *      后两类走 `agent/pre-step`（技能目录是以 `<system-reminder>` 注入 user 消息的）——
 *      文本没变的就是缺口，输出清单。
 *
 * 怎么读结果：
 *   - 清单里含 `${...}` 的条目多半是**假缺口**：那是模板串，运行时才填值，而表里是用
 *     `PATTERNS` 匹配"填好值"之后的文本。用渲染后的真实文本复核（`self-test.mjs` 里有现成的
 *     渲染用例集）。
 *   - 真缺口：把英文原文补进 `cangjie-zh.mjs` 的 `PROSE`（工具描述按句子片段收，一次覆盖
 *     多个配置变体）；含数字/名字的补进 `PATTERNS`。
 *   - 跑完记得用 `self-test.mjs` 再验一遍：变量检查、身份段注入、幂等性都在那边守。
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = process.argv[2] ?? process.env.DSH_CHECKOUT
if (ROOT === undefined || ROOT.length === 0) {
	console.error('用法：node audit-coverage.mjs <DSH 源码根目录>（或用环境变量 DSH_CHECKOUT）')
	process.exit(2)
}
const PLUGIN = new URL('./cangjie-zh.mjs', import.meta.url)

const SKIP = /(\\|\/)(node_modules|dist|lib|build|\.git|\.probe|\.idea|\.npm-cache|coverage|snapshots|fixtures|\.agents)(\\|\/)/i
const IS_TEST = /(\\|\/)tests?(\\|\/)|\.spec\.ts$|\.test\.ts$/i
const normalize = text => text.replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, ' ').trim()

// ── 1. 源码里的 section / 工具 / 参数文本 ─────────────────────────────────────
const quoted = /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g
const sourceItems = []
const scanSource = dir => {
	let entries
	try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
	for (const entry of entries) {
		const full = path.join(dir, entry.name)
		if (entry.isDirectory()) { if (!SKIP.test(full + path.sep)) scanSource(full); continue }
		if (!/\.(ts|tsx)$/.test(entry.name) || SKIP.test(full) || IS_TEST.test(full)) continue
		let raw
		try { raw = fs.readFileSync(full, 'utf8') } catch { continue }
		const folded = raw.replace(/['"]\s*\+\s*['"]/g, '')
		quoted.lastIndex = 0
		let hit
		while ((hit = quoted.exec(folded)) !== null) {
			const value = hit[1] ?? hit[2] ?? hit[3]
			if (value === undefined) continue
			const plain = value.replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\n/g, ' ').replace(/\\`/g, '`')
			if (plain.length < 80 || (plain.match(/[A-Za-z][A-Za-z'’-]*/g) ?? []).length < 8) continue
			if (/[\u4e00-\u9fff]|=>|process\.|require\(|import |function |JSON\./.test(plain)) continue
			// 图标与转义过的中文（`\uXXXX`）不是提示词文本。
			if (/base64,|\\u[0-9a-fA-F]{4}/.test(plain)) continue
			// 只收**就近挂在锚点上的**文本：离最近的 `defineTool(` / `systemPrompt.section(` /
			// `systemPrompt.context(` 超过 4000 字符就不认（config-schema 的字段文档、GUI 文案
			// 都远离这些锚点，不属于模型看到的系统提示词）。
			const anchors = [
				[folded.lastIndexOf('defineTool(', hit.index), 'tool'],
				[folded.lastIndexOf('systemPrompt.section(', hit.index), 'section'],
				[folded.lastIndexOf('systemPrompt.context(', hit.index), 'section'],
			].filter(([at]) => at >= 0 && hit.index - at <= 4000)
			if (anchors.length === 0) continue
			const kind = anchors.reduce((best, current) => (current[0] > best[0] ? current : best))[1]
			sourceItems.push({ file: path.relative(ROOT, full), kind, text: normalize(plain) })
		}
	}
}
scanSource(path.join(ROOT, 'packages'))

// ── 2. 技能描述与技能目录散文（走 `agent/pre-step`）────────────────────────────
const skillItems = []
const scanSkills = dir => {
	let entries
	try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
	for (const entry of entries) {
		const full = path.join(dir, entry.name)
		if (entry.isDirectory()) { if (!SKIP.test(full + path.sep)) scanSkills(full); continue }
		if (entry.name !== 'SKILL.md') continue
		const raw = fs.readFileSync(full, 'utf8')
		const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw)
		if (front === null) continue
		const lines = front[1].split(/\r?\n/)
		for (const [index, line] of lines.entries()) {
			const match = /^description:\s*(.*)$/.exec(line)
			if (match === null) continue
			let value = match[1].trim()
			if (['>', '|', '>-', '|-'].includes(value)) {
				const block = []
				for (const next of lines.slice(index + 1)) {
					if (!/^\s+\S/.test(next)) break
					block.push(next.trim())
				}
				value = block.join(' ')
			}
			value = value.replace(/^['"]|['"]$/g, '').replace(/\s+/g, ' ').trim()
			if (value.length > 0) skillItems.push({ file: path.relative(ROOT, full), kind: 'skill', text: value })
		}
	}
}
scanSkills(path.join(ROOT, 'packages'))

const toolSkillPath = path.join(ROOT, 'packages/skill/tool-skill/src/index.ts')
if (fs.existsSync(toolSkillPath)) {
	const folded = fs.readFileSync(toolSkillPath, 'utf8').replace(/['"]\s*\+\s*['"]/g, '')
	quoted.lastIndex = 0
	let hit
	while ((hit = quoted.exec(folded)) !== null) {
		const value = hit[1] ?? hit[3]
		if (value === undefined) continue
		const plain = value.replace(/\\'/g, "'").replace(/\\n/g, '\n').replace(/\\`/g, '`')
		if (plain.length < 60 || !/[A-Za-z]{3,}\s+[A-Za-z]{3,}/.test(plain) || /[\u4e00-\u9fff]/.test(plain)) continue
		skillItems.push({ file: 'packages/skill/tool-skill/src/index.ts', kind: 'catalog', text: normalize(plain) })
	}
}

// ── 3. 用插件自己的翻译路径实测 ───────────────────────────────────────────────
const mod = await import(PLUGIN.href)
let assembleHandler
let stepHandler
mod.apply({
	on: (event, fn) => {
		if (event === 'system-prompt/assemble') assembleHandler = fn
		if (event === 'agent/pre-step') stepHandler = fn
	},
})
if (assembleHandler === undefined || stepHandler === undefined) throw new Error('插件没有注册预期的监听器')

const throughAssemble = async text => {
	const sections = [
		{ name: 'harness:identity', text: 'You are an AI agent powered by DeepSeek Harness.' },
		{ name: 'probe', text },
	]
	const out = await assembleHandler(null, null, async () => ({ sections, contexts: [], tools: [], variables: { provider: 'p', model: 'm' } }))
	return out.sections[1].text
}
const throughStep = async text => {
	const wrapped = `<system-reminder>\n${text}\n</system-reminder>`
	const decision = await stepHandler(null, async () => ({
		kind: 'continue',
		messages: [{ id: 'probe', role: 'user', content: [{ type: 'text', text: wrapped }] }],
	}))
	return decision.messages[0].content[0].text
}

const seen = new Set()
const uncovered = []
for (const item of sourceItems) {
	const key = item.text.slice(0, 90)
	if (seen.has(key)) continue
	seen.add(key)
	const after = await throughAssemble(item.kind === 'section' ? item.text : `/** ${item.text} */`)
	if (after.replace(/^\/\*\* | \*\/$/g, '') === item.text) uncovered.push(item)
}
for (const item of skillItems) {
	const key = item.text.slice(0, 90)
	if (seen.has(key)) continue
	seen.add(key)
	const after = await throughStep(item.text)
	if (after.includes(item.text)) uncovered.push(item)
}

console.log(`源码候选 ${sourceItems.length} 条、技能/目录 ${skillItems.length} 条｜未覆盖 ${uncovered.length} 条`)
console.log('')
for (const [index, item] of uncovered.entries()) {
	console.log(`#${index} [${item.kind}] ${item.file}`)
	console.log('   ' + item.text.slice(0, 170))
}
if (uncovered.length > 0) {
	console.log('')
	console.log(`含 \${...} 的条目多半是假缺口（运行时才填值，表里用 PATTERNS 匹配填好值的文本）——先用 self-test.mjs 的渲染用例复核。`)
}
