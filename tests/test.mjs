// index.html の CORE ロジック（パーサ・抽選）のユニットテスト
// 実行: node tests/test.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import assert from "node:assert/strict";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "..", "index.html"), "utf8");

// CORE ブロックを抽出して評価する（単一HTML成果物を保ったままテストするため）
const m = html.match(/\/\* ===== CORE-START ===== \*\/([\s\S]*?)\/\* ===== CORE-END ===== \*\//);
assert.ok(m, "COREブロックが index.html に見つかること");
const core = new Function(m[1] + "; return { parsePRTable, splitReviewers, isReadyForReview, isFinished, computeState, probsFor, pickIndex };")();

const MEMBERS = ["榊原", "北山", "小川", "小平", "村岡"];
let passed = 0;
function test(name, fn){ fn(); passed++; console.log("ok - " + name); }

// ---------- パーサ ----------
const SAMPLE = [
  "PR\t作成者\tレビュアー\tstatus",
  "feat: セル結合の修正\t榊原\t村岡\tRequest changes",
  "feat: 表領域の検出改善\tNaveed\t\tReady for review",
  "fix: OCRフォールバック\t小平\t小川\tReady for review",
  "refactor: 前処理整理\t榊原\t\t",                       // status空 → 対象外（F9）
  "feat: 見出し階層の推定\t榊原\t小平\tReady for review",
  "fix: ページ分割バグ\t榊原\t村岡\tApprove",
  "docs: README更新\t榊原\t北山\tApprove",
  "feat: 罫線なし表対応\t小川\t\tready for REVIEW",        // 表記揺れ → 対象（F9）
  "",                                                      // 空行
  "chore: CI改善\t村岡\t小平\tReady for review",
].join("\n");

test("F5: 負荷 = レビュアー列の出現回数", () => {
  const st = core.computeState(core.parsePRTable(SAMPLE), MEMBERS);
  assert.deepEqual(st.loads, { 榊原: 0, 北山: 1, 小川: 1, 小平: 2, 村岡: 2 });
});

test("F1/F9: 対象PR = Ready for review かつレビュアー空（表記揺れ許容・status空は対象外）", () => {
  const st = core.computeState(core.parsePRTable(SAMPLE), MEMBERS);
  assert.deepEqual(st.unassigned.map(p => p.title), ["feat: 表領域の検出改善", "feat: 罫線なし表対応"]);
  assert.deepEqual(st.unassigned.map(p => p.author), ["Naveed", "小川"]);
});

test("ヘッダ行はスキップされる（『PR』行が負荷に混入しない）", () => {
  const st = core.computeState(core.parsePRTable(SAMPLE), MEMBERS);
  assert.equal("レビュアー" in st.loads, false);
  assert.equal(st.unknown.includes("レビュアー"), false);
});

test("レビュアー複数名（、 , / スペース区切り）を各1件と数える", () => {
  const t = "a\t榊原\t村岡、小平\tReady for review\nb\t榊原\t北山, 小川\tApprove\nc\t榊原\t小平/村岡\tApprove";
  const st = core.computeState(core.parsePRTable(t), MEMBERS);
  assert.deepEqual(st.loads, { 榊原: 0, 北山: 1, 小川: 1, 小平: 2, 村岡: 2 });
});

test("メンバー外のレビュアー名は unknown に集まり負荷に混入しない", () => {
  const t = "a\t榊原\t谷本\tReady for review";
  const st = core.computeState(core.parsePRTable(t), MEMBERS);
  assert.deepEqual(st.unknown, ["谷本"]);
  assert.equal(Object.values(st.loads).reduce((a, b) => a + b, 0), 0);
});

test("タブ無し（2個以上の連続空白区切り）でも解析できる", () => {
  const t = "fix: バグ  榊原  村岡  Ready for review";
  const rows = core.parsePRTable(t);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].reviewer, "村岡");
});

test("解析不能な入力は空配列（例外を出さない）", () => {
  assert.deepEqual(core.parsePRTable("こんにちは"), []);
  assert.deepEqual(core.parsePRTable(""), []);
  assert.deepEqual(core.parsePRTable(null), []);
});

test("isReadyForReview: 揺れ許容・他statusは不一致", () => {
  assert.equal(core.isReadyForReview("Ready for review"), true);
  assert.equal(core.isReadyForReview(" READY FOR REVIEW "), true);
  assert.equal(core.isReadyForReview("Readyforreview"), true);
  assert.equal(core.isReadyForReview("Approve"), false);
  assert.equal(core.isReadyForReview(""), false);
  assert.equal(core.isReadyForReview(undefined), false);
});

// ---------- Notion の「unstructured PR 管理DB」からの貼り付け ----------
// 表ビューで全行を選択してコピーした想定（見出し行あり・列が 6 つ・status はハイフン区切り）
const DB_SAMPLE = [
  "PR\t作成者\tレビュアー\tstatus\t説明済み\tURL",
  "#899 feat: pr-review-recap skill\t小平\t\twork-in-progress（作業中）\tNo\t",
  "#907 fix: macOS runner\t榊原\t小川\tready-to-merge（マージ待ち）\tNo\t",
  "#909 feat: Excel データセット\t榊原\t村岡\tready-for-review（レビュー待ち）\tYes\t",
  "#911 feat: [Sprint 1]\t小川\t小平\tready-for-review（レビュー待ち）\tNo\t",
  "#913 feat: [Sprint 2]\t小川\t小平, 村岡\tin-review（レビュー中）\tNo\t",
  "#920 feat: [Sprint 5]\t小川\t\tready-for-review（レビュー待ち）\tNo\t",
  "#921 feat: 下書き\t榊原\t\tdraft\tNo\t",
  "#890 fix: 済んだもの\t村岡\t小川\tmerged\tYes\t",
  "#880 fix: 閉じたもの\t村岡\t榊原, 小平\tclosed\tNo\t",
  "#870 fix: 閉じた未割当\t村岡\t\tready-for-review（レビュー待ち）, closed\tNo\t",
].join("\n");

test("DB: ハイフン区切りの ready-for-review を対象PRとして拾う", () => {
  const st = core.computeState(core.parsePRTable(DB_SAMPLE), MEMBERS);
  assert.deepEqual(st.unassigned.map(p => p.title), ["#920 feat: [Sprint 5]"]);
  assert.deepEqual(st.unassigned.map(p => p.author), ["小川"]);
});

test("DB: merged・closed の行は負荷に数えない（説明済みは関係なく数える）", () => {
  const st = core.computeState(core.parsePRTable(DB_SAMPLE), MEMBERS);
  assert.deepEqual(st.loads, { 榊原: 0, 北山: 0, 小川: 1, 小平: 2, 村岡: 2 });
  assert.deepEqual(st.unknown, []);
});

test("DB: 見出し行から列を判定する（列の並び替えに耐える・余計な列は無視）", () => {
  const t = [
    "説明済み\tstatus\tPR\tレビュアー\t作成者",
    "No\tready-for-review（レビュー待ち）\t#1 a\t\t榊原",
    "No\tin-review（レビュー中）\t#2 b\t小平\t小川",
  ].join("\n");
  const st = core.computeState(core.parsePRTable(t), MEMBERS);
  assert.deepEqual(st.unassigned, [{ title: "#1 a", author: "榊原" }]);
  assert.equal(st.loads.小平, 1);
});

test("DB: 見出しに status 列が無ければ status は空（別の列と取り違えない・PR 列名が違えば先頭列）", () => {
  const t = "タイトル案\t作成者\tレビュアー\t説明済み\nfix: a\t榊原\t小平\tNo";
  const rows = core.parsePRTable(t);
  assert.deepEqual(rows, [{ title: "fix: a", author: "榊原", reviewer: "小平", status: "" }]);
});

test("DB: Markdown の表形式（| 区切り）でも解析できる", () => {
  const t = [
    "| PR | 作成者 | レビュアー | status |",
    "| --- | --- | --- | --- |",
    "| #1 a | 榊原 |  | ready-for-review（レビュー待ち） |",
    "| #2 b | 小川 | 村岡 | in-review（レビュー中） |",
  ].join("\n");
  const st = core.computeState(core.parsePRTable(t), MEMBERS);
  assert.deepEqual(st.unassigned, [{ title: "#1 a", author: "榊原" }]);
  assert.equal(st.loads.村岡, 1);
});

// 実際に Notion の表でセルを選択してコピーした結果（見出し行なし・6 列: PR / 作成者 / レビュアー / status / 説明済み / URL）
const DB_CELL_COPY = [
  "#899 feat: pr-review-recap skill を追加する\t小平\t\twork-in-progress（作業中）\tNo\thttps://github.com/stockmarkteam/unstructured/pull/899",
  "#907 fix: macOS uv sync の runner を変更する\t榊原\t小川\tready-for-review（レビュー待ち）\tNo\thttps://github.com/stockmarkteam/unstructured/pull/907",
  "#909 feat: 公開 Excel 様式のデータセット\t榊原\t村岡\tready-for-review（レビュー待ち）\tNo\thttps://github.com/stockmarkteam/unstructured/pull/909",
  "#911 feat: [Sprint 1]\t小川\t小平\tready-for-review（レビュー待ち）\tNo\thttps://github.com/stockmarkteam/unstructured/pull/911",
  "#913 feat: [Sprint 2]\t小川\t小平\tready-for-review（レビュー待ち）\tNo\thttps://github.com/stockmarkteam/unstructured/pull/913",
  "#915 feat: [Sprint 3]\t小川\t小平\tready-for-review（レビュー待ち）\tNo\thttps://github.com/stockmarkteam/unstructured/pull/915",
  "#918 feat: [Sprint 4]\t小川\t村岡\tready-for-review（レビュー待ち）\tNo\thttps://github.com/stockmarkteam/unstructured/pull/918",
  "#921 feat: 確認用の未割当\t榊原\t\tready-for-review（レビュー待ち）\tNo\thttps://github.com/stockmarkteam/unstructured/pull/921",
].join("\n");

test("DB: セル選択のコピー（見出し行なし）を列の並びで読み、負荷と対象PRを出す", () => {
  const rows = core.parsePRTable(DB_CELL_COPY);
  assert.equal(rows.length, 8);
  assert.deepEqual(rows[1], { title: "#907 fix: macOS uv sync の runner を変更する", author: "榊原", reviewer: "小川", status: "ready-for-review（レビュー待ち）" });
  const st = core.computeState(rows, ["榊原", "小川", "小平", "村岡"]);
  assert.deepEqual(st.loads, { 榊原: 0, 小川: 1, 小平: 3, 村岡: 2 });
  assert.deepEqual(st.unassigned, [{ title: "#921 feat: 確認用の未割当", author: "榊原" }]);
  assert.deepEqual(st.unknown, []);
});

test("DB: 行の選択でコピーした PR 名だけの貼り付けは 0 行（誤って行を作らない）", () => {
  const t = [
    "# #915 feat: [Sprint 3] 軽量モデル",
    "",
    "[#913 feat: [Sprint 2] 頁の構造化](https://app.notion.com/p/913-feat-Sprint-2-Gemini-425e3679a1b8810db728fa4c0ac47c59?pvs=21)",
    "",
    "#909 feat: 公開 Excel 様式のデータセット",
    "[**#920 feat: [Sprint 5] 預けた文書**](https://app.notion.com/p/920-feat-Sprint-5-425e3679a1b88049b896c824222b635f?pvs=21)",
  ].join("\n");
  assert.deepEqual(core.parsePRTable(t), []);
});

test("isReadyForReview: ハイフン・アンダースコア区切りも一致", () => {
  assert.equal(core.isReadyForReview("ready-for-review（レビュー待ち）"), true);
  assert.equal(core.isReadyForReview("ready_for_review"), true);
  assert.equal(core.isReadyForReview("in-review（レビュー中）"), false);
});

test("isFinished: merged・closed のみ一致", () => {
  assert.equal(core.isFinished("merged"), true);
  assert.equal(core.isFinished("ready-for-review（レビュー待ち）, closed"), true);
  assert.equal(core.isFinished("ready-to-merge（マージ待ち）"), false);
  assert.equal(core.isFinished(""), false);
});

// ---------- 抽選 ----------
test("probsFor: 負荷[0,1,2] → 確率が 1 : 1/2 : 1/3 の正規化と一致", () => {
  const p = core.probsFor([0, 1, 2]);
  const s = 1 + 0.5 + 1 / 3;
  assert.ok(Math.abs(p[0] - 1 / s) < 1e-12);
  assert.ok(Math.abs(p[1] - 0.5 / s) < 1e-12);
  assert.ok(Math.abs(p[2] - (1 / 3) / s) < 1e-12);
  assert.ok(Math.abs(p.reduce((a, b) => a + b, 0) - 1) < 1e-12);
});

test("pickIndex: 境界値（rnd=0 → 先頭、rnd≈1 → 末尾）", () => {
  const p = core.probsFor([0, 1, 2]);
  assert.equal(core.pickIndex(p, 0), 0);
  assert.equal(core.pickIndex(p, 0.999999999), 2);
});

test("抽選分布: 200,000回シミュレーションが理論確率±1%以内", () => {
  const loads = [0, 1, 1, 2, 2]; // 現PR表の負荷（榊原,北山,小川,小平,村岡）
  const p = core.probsFor(loads);
  const N = 200000;
  const cnt = new Array(loads.length).fill(0);
  for (let i = 0; i < N; i++) cnt[core.pickIndex(p, Math.random())]++;
  for (let i = 0; i < loads.length; i++){
    const got = cnt[i] / N;
    assert.ok(Math.abs(got - p[i]) < 0.01, `index ${i}: got ${got.toFixed(4)}, want ${p[i].toFixed(4)}`);
  }
  // 期待値の確認: 負荷0の榊原が37.5%
  assert.ok(Math.abs(p[0] - 0.375) < 1e-9);
});

console.log(`\n${passed} tests passed`);
