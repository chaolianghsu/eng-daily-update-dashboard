import { createRoot } from "react-dom/client";
import App from "./App";
import type { LoadData } from "./types";

const gsr = <T,>(fn: string): Promise<T> =>
  new Promise((resolve, reject) =>
    google.script.run
      .withSuccessHandler((s: string) => resolve(JSON.parse(s)))
      .withFailureHandler(reject)
      [fn]()
  );

const loadData: LoadData = async () => {
  const [raw, commits, tasks] = await Promise.all([
    gsr<{ rawData: any; issues: any; leave: any }>("getDashboardData"),
    gsr<any>("getCommitData").catch(() => null),
    gsr<any>("getTaskAnalysisData").catch(() => null),
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
