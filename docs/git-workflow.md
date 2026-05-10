# Git 工作流

## 执行命令

当用户说"执行 git 工作流"时，按以下步骤执行：

## 流程

### 小改动（当前分支已在 dev）

如果当前分支就是 `dev`，且改动较小（bug fix、typo、小 UI 调整、配置变更），走此快速流程：

1. **直接在 dev 上修改**
2. **运行 build 检查**
   ```bash
   pnpm build
   ```
3. **提交并推送**
   ```bash
   git add .
   git commit -m "fix: xxx"
   git push origin dev
   ```
4. **合并到 main**
   ```bash
   git checkout main
   git merge --no-ff dev -m "merge: dev into main - [摘要]"
   git push origin main
   ```
5. **签回 dev**
   ```bash
   git checkout dev
   ```

无需功能分支，无需等待验证，直接走完。

### 大改动（需要功能分支）

1. **检查当前分支**
   - 如果在 `dev` 或 `main` 分支，提示用户先切到功能分支
   - 如果在其他分支，继续执行

2. **运行 build 检查**
   ```bash
   pnpm build
   ```
   - 如果 build 失败，停止流程，提示用户修复
   - 如果 build 成功，继续执行

3. **提交当前修改**
   - `git add .`
   - `git commit`（使用英文 Conventional Commits 格式）

4. **合并到 dev**
   ```bash
   git checkout dev
   git merge <当前分支>
   git push origin dev
   ```

5. **合并到 main**
   ```bash
   git checkout main
   git merge dev
   git push origin main
   ```

6. **清理并切回 dev**
   ```bash
   git checkout dev
   git branch -d <当前分支>
   git push origin --delete <当前分支>
   ```

7. **等待下一步指示**

## 注意事项

- Commit 消息使用英文，格式：`feat:`, `fix:`, `chore:`, `docs:` 等
- 每次合并前必须通过 build
- 合并失败时停止流程，让用户手动解决冲突
- 功能分支合并完成后自动删除
