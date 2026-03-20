import { useLanguageStore, type Lang } from "@/stores/language-store";

type Dict = Record<string, string>;

const zh: Dict = {
  "dashboard.newProject": "新建项目",
  "dashboard.myProjects": "我的项目",
  "dashboard.subtitle": "创建新项目或打开已有项目开始构建。",
  "dashboard.noProjects": "暂无项目",
  "dashboard.noProjectsDesc": "告诉我们你想做什么，我们马上开始！",
  "dashboard.startBuilding": "开始构建",
  "dashboard.dialogTitle": "今天你想做什么？😉",
  "dashboard.ideaPlaceholder": "例如：贪吃蛇游戏、个人主页、待办事项...",
  "dashboard.cancel": "取消",
  "dashboard.letsGo": "出发！",
  "dashboard.renameProject": "重命名项目",
  "dashboard.newName": "新名称",
  "dashboard.rename": "重命名",
  "dashboard.deleteProject": "删除项目？",
  "dashboard.deleteDesc": "这将永久删除此项目及其所有文件，此操作无法撤销。",
  "dashboard.delete": "删除",

  "navbar.workspace": "工作区",
  "navbar.notebook": "我的编程笔记",
  "navbar.run": "运行",
  "navbar.notebookOutdated": "笔记已过时",

  "files.title": "文件",
  "files.newFile": "新建文件",
  "files.newFolder": "新建文件夹",
  "files.preview": "预览",
  "files.rename": "重命名",
  "files.duplicate": "复制",
  "files.delete": "删除",
  "files.deleteFolder": "删除文件夹？",
  "files.deleteFile": "删除文件？",
  "files.deleteDesc": "确认删除 \"{name}\"？此操作无法撤销。",
  "files.cancel": "取消",
  "files.ariaNewFile": "新建文件",
  "files.ariaNewFolder": "新建文件夹",
  "files.ariaClose": "关闭面板",

  "dock.files": "文件",
  "dock.chat": "AI 对话",
  "dock.console": "控制台",

  "console.title": "控制台",
  "console.empty": "暂无控制台输出。运行代码后结果将显示在这里。",
  "console.clear": "清除控制台",
  "console.close": "关闭控制台",

  "chat.title": "AI 对话",
  "chat.close": "关闭面板",

  "notebook.title": "我的编程笔记",
  "notebook.emptyDesc": "你的专属代码学习指南",
  "notebook.generate": "生成笔记",
  "notebook.generatingTitle": "正在生成编程笔记...",
  "notebook.generatingTime": "通常需要 10–20 秒",
  "notebook.loading0": "正在阅读你的代码...",
  "notebook.loading1": "识别关键概念...",
  "notebook.loading2": "梳理文件关联...",
  "notebook.loading3": "为你准备学习提示...",
  "notebook.loading4": "构建思维导图...",
  "notebook.loading5": "即将完成...",
  "notebook.companion": "你的学习伴侣",
  "notebook.updated": "已更新 {date}",
  "notebook.optimize": "优化笔记",
  "notebook.optimizing": "正在更新笔记以反映最新更改...",
  "notebook.stale": "代码已更改，笔记需要更新。",
  "notebook.update": "更新",
  "notebook.summary": "项目总览",
  "notebook.mindmap": "思维导图",
  "notebook.mindmapHint": "悬停文件节点查看说明，点击展开功能详情，点击子节点可固定说明",
  "notebook.deepDive": "深度解析",
  "notebook.features": "功能",
  "notebook.keyConcepts": "关键概念",
  "notebook.connectedFiles": "关联文件",
  "notebook.learningTips": "学习提示",
  "notebook.detailsPending": "详情待生成",
  "notebook.oops": "出错啦！",
  "notebook.retry": "重试",
};

const en: Dict = {
  "dashboard.newProject": "New Project",
  "dashboard.myProjects": "My Projects",
  "dashboard.subtitle": "Create a new project or open an existing one to start building.",
  "dashboard.noProjects": "No projects yet",
  "dashboard.noProjectsDesc": "Tell us what you want to build and we'll get started right away!",
  "dashboard.startBuilding": "Start Building",
  "dashboard.dialogTitle": "What do you want to build today? 😉",
  "dashboard.ideaPlaceholder": "e.g. A snake game, a personal portfolio, a to-do list...",
  "dashboard.cancel": "Cancel",
  "dashboard.letsGo": "Let's Go!",
  "dashboard.renameProject": "Rename Project",
  "dashboard.newName": "New name",
  "dashboard.rename": "Rename",
  "dashboard.deleteProject": "Delete Project?",
  "dashboard.deleteDesc": "This will permanently delete this project and all its files. This action cannot be undone.",
  "dashboard.delete": "Delete",

  "navbar.workspace": "Workspace",
  "navbar.notebook": "My Coding Notebook",
  "navbar.run": "Run",
  "navbar.notebookOutdated": "Notebook is outdated",

  "files.title": "Files",
  "files.newFile": "New File",
  "files.newFolder": "New Folder",
  "files.preview": "Preview",
  "files.rename": "Rename",
  "files.duplicate": "Duplicate",
  "files.delete": "Delete",
  "files.deleteFolder": "Delete folder?",
  "files.deleteFile": "Delete file?",
  "files.deleteDesc": "Are you sure you want to delete \"{name}\"? This action cannot be undone.",
  "files.cancel": "Cancel",
  "files.ariaNewFile": "New file",
  "files.ariaNewFolder": "New folder",
  "files.ariaClose": "Close panel",

  "dock.files": "Files",
  "dock.chat": "AI Chat",
  "dock.console": "Console",

  "console.title": "Console",
  "console.empty": "No console output yet. Run your code to see results here.",
  "console.clear": "Clear console",
  "console.close": "Close console",

  "chat.title": "AI Chat",
  "chat.close": "Close panel",

  "notebook.title": "My Coding Notebook",
  "notebook.emptyDesc": "Your personal guide to understanding your code",
  "notebook.generate": "Generate Notebook",
  "notebook.generatingTitle": "Generating My Coding Notebook...",
  "notebook.generatingTime": "This usually takes 10–20 seconds",
  "notebook.loading0": "Reading through your code...",
  "notebook.loading1": "Identifying key concepts...",
  "notebook.loading2": "Mapping connections between files...",
  "notebook.loading3": "Preparing learning tips just for you...",
  "notebook.loading4": "Building your mind map...",
  "notebook.loading5": "Almost ready...",
  "notebook.companion": "Your learning companion",
  "notebook.updated": "Updated {date}",
  "notebook.optimize": "Optimize Notebook",
  "notebook.optimizing": "Updating your notebook with the latest changes...",
  "notebook.stale": "Your code has changed since this notebook was generated.",
  "notebook.update": "Update",
  "notebook.summary": "Project Overview",
  "notebook.mindmap": "Mind Map",
  "notebook.mindmapHint": "Hover file nodes to view descriptions, click to expand features, click child nodes to pin descriptions",
  "notebook.deepDive": "Deep Dive",
  "notebook.features": "Features",
  "notebook.keyConcepts": "Key Concepts",
  "notebook.connectedFiles": "Connected Files",
  "notebook.learningTips": "Learning Tips",
  "notebook.detailsPending": "Details pending",
  "notebook.oops": "Oops!",
  "notebook.retry": "Try Again",
};

const DICTS: Record<Lang, Dict> = { zh, en };

export function tr(lang: Lang, key: string, vars?: Record<string, string>): string {
  const dict = DICTS[lang];
  let str = dict[key] ?? en[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      str = str.replace(`{${k}}`, v);
    }
  }
  return str;
}

export function useT() {
  const { lang } = useLanguageStore();
  return (key: string, vars?: Record<string, string>): string => tr(lang, key, vars);
}
