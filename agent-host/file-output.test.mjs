import test from "node:test";
import assert from "node:assert/strict";
import { fileMarkdownLink, attachmentPromptText } from "./file-output.mjs";
import { nextMarkdownLink, parseMarkdownLink } from "../src/utils/markdownLinks.ts";
import { classifyLinkTarget } from "../src/utils/linkTarget.ts";

test("附件链接保留中文、空格、括号和特殊字符，并能恢复为原始本地路径", () => {
  for (const name of ["需求表 9.22.xlsx", "说明[正式].docx", "预览(未闭合.pdf", "结果 #1%2.png"]) {
    const path = `C:/工作目录/${name}`;
    const link = fileMarkdownLink(name, path);
    const token = nextMarkdownLink(`已读取 ${link}，请查看。`, 0);
    assert.equal(token.token, link);
    const parsed = parseMarkdownLink(link);
    assert.equal(parsed.label, name);
    assert.equal(parsed.target, `<${path}>`);
    const url = `/codex-local-browse/${encodeURI(path).replaceAll("#", "%23").replaceAll("?", "%3F")}`;
    assert.equal(classifyLinkTarget(url, "http://tauri.localhost").path, path);
  }
});

test("长路径前缀被规范化；未知路径、网址和错误附件不会冒充已读取文件", () => {
  assert.equal(fileMarkdownLink("表.xlsx", "//?/C:/资料/表.xlsx"), "[表.xlsx](<C:/资料/表.xlsx>)");
  assert.equal(fileMarkdownLink("表.xlsx", "//?/UNC/server/资料/表.xlsx"), "[表.xlsx](<//server/资料/表.xlsx>)");
  for (const path of [undefined, "file.xlsx", "https://example.com/file.xlsx", "C:/file\nname.xlsx"]) assert.equal(fileMarkdownLink("file.xlsx", path), "");
  const prompt = attachmentPromptText([{ name: "表.xlsx", source_path: "C:/资料/表.xlsx", text_content: "旧正文", error: "读取中断" }]);
  assert.match(prompt, /读取中断/);
  assert.doesNotMatch(prompt, /旧正文/);
  assert.match(prompt, /markdown_link/);
});
