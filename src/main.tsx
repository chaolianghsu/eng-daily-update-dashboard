import { createRoot } from "react-dom/client";
import App from "./App";
import type { LoadData } from "./types";

const loadData: LoadData = async () => {
  const [raw, commits, tasks] = await Promise.all([
    fetch("raw_data.json").then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }),
    fetch("gitlab-commits.json").then(r => r.ok ? r.json() : null).catch(() => null),
    fetch("task-analysis.json").then(r => r.ok ? r.json() : null).catch(() => null),
  ]);
  return {
    rawData: raw.rawData,
    issues: raw.issues || [],
    leave: raw.leave || {},
    commitData: commits,
    taskAnalysisData: tasks,
  };
};

createRoot(document.getElementById("root")!).render(<App loadData={loadData} />);
