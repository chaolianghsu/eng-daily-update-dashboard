import { useState, useEffect } from "react";

import { COLORS, THRESHOLDS, MEETING_HEAVY_PCT, WEEK_DAYS, MEMBER_PALETTE } from "./constants";
import { tabStyle } from "./components";
import CommitsView from "./CommitsView";
import PlanSpecView from "./PlanSpecView";
import { StatusOverview } from "./views/StatusOverview";
import { DailyView } from "./views/DailyView";
import { TrendView } from "./views/TrendView";
import { WeeklyView } from "./views/WeeklyView";
import { useWeekNavigator } from "./hooks/useWeekNavigator";
import { useDailyBarData } from "./hooks/useDailyBarData";
import { useTrendData } from "./hooks/useTrendData";
import { useWeeklySummary } from "./hooks/useWeeklySummary";
import { useAllIssues } from "./hooks/useAllIssues";
import type { LoadData, CommitData, TaskAnalysisData, PlanAnalysisData } from "./types";
import "./styles.css";

export default function App({ loadData }: { loadData: LoadData }) {
  const [view, setView] = useState("daily");
  const [rawData, setRawData] = useState<Record<string, Record<string, any>> | null>(null);
  const [issues, setIssues] = useState<any[]>([]);
  const [leave, setLeave] = useState<Record<string, any[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  const [commitData, setCommitData] = useState<CommitData | null>(null);
  const [taskAnalysisData, setTaskAnalysisData] = useState<TaskAnalysisData | null>(null);
  const [planAnalysisData, setPlanAnalysisData] = useState<PlanAnalysisData | null>(null);
  const [selectedMembers, setSelectedMembers] = useState<Set<string>>(new Set());
  const [trendRange, setTrendRange] = useState("2weeks");

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    loadData()
      .then(data => {
        setRawData(data.rawData);
        setIssues(data.issues);
        setLeave(data.leave);
        setCommitData(data.commitData);
        setTaskAnalysisData(data.taskAnalysisData);
        setPlanAnalysisData(data.planAnalysisData);
        setLoading(false);
      })
      .catch(err => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  const dates = rawData ? Object.keys(rawData) : [];
  const members = rawData ? [...new Set(dates.flatMap(d => Object.keys(rawData[d])))] : [];
  const dayLabels = Object.fromEntries(dates.map(d => {
    const [m, dd] = d.split("/").map(Number);
    const dow = new Date(new Date().getFullYear(), m - 1, dd).getDay();
    return [d, WEEK_DAYS[dow]];
  }));
  const memberColors = Object.fromEntries(members.map((m, i) => [m, MEMBER_PALETTE[i % MEMBER_PALETTE.length]]));
  const issueMap = Object.fromEntries(issues.map(iss => [iss.member, iss]));

  const weekNav = useWeekNavigator(dates);
  const dailyDates = weekNav.currentWeek.dates;
  const activeDate = (selectedDate && dailyDates.includes(selectedDate))
    ? selectedDate
    : dailyDates[dailyDates.length - 1] || dates[dates.length - 1];
  const chartHeight = isMobile ? 280 : 380;

  const dailyBarData = useDailyBarData(rawData, activeDate, members);
  const { trendDates, trendData, useWeeklyAgg, weekGroups } = useTrendData(rawData, dates, members, dayLabels, commitData, trendRange);
  const weeklySummary = useWeeklySummary(rawData, dates, members, commitData);
  const allIssues = useAllIssues(issues, commitData, activeDate);

  const toggleMember = (m: string) => {
    const next = new Set(selectedMembers);
    selectedMembers.has(m) ? next.delete(m) : next.add(m);
    setSelectedMembers(next);
  };

  const dateSelectAndSwitchToCommits = (d: string) => {
    setSelectedDate(d);
    setView('commits');
  };

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", background: COLORS.bg, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16 }}>
        <div style={{ width: 40, height: 40, border: `3px solid ${COLORS.border}`, borderTopColor: COLORS.accent, borderRadius: "50%", animation: "spin 0.7s linear infinite" }} />
        <p style={{ color: COLORS.textMuted, fontSize: 14, fontFamily: "'JetBrains Mono','SF Mono',monospace" }}>載入資料中...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ minHeight: "100vh", background: COLORS.bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <p style={{ color: COLORS.red, fontSize: 16, fontFamily: "'JetBrains Mono','SF Mono',monospace" }}>載入失敗：{error}</p>
      </div>
    );
  }

  return (
    <div className="dashboard-container" style={{ minHeight: "100vh", background: "transparent", color: COLORS.text, padding: "24px 16px", fontFamily: "'JetBrains Mono','SF Mono','Noto Sans TC',monospace" }}>
      <div style={{ maxWidth: 1000, margin: "0 auto" }}>

        {/* Header */}
        <div className="animate-in" style={{ marginBottom: 24 }}>
          <h1 className="dashboard-title" style={{
            fontSize: 28, fontWeight: 800, margin: 0,
            fontFamily: "'Bricolage Grotesque','Noto Sans TC',sans-serif",
            background: "linear-gradient(135deg, #60a5fa 0%, #a78bfa 50%, #f472b6 100%)",
            WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
          }}>
            工程部 Daily Update
          </h1>
          <p className="dashboard-subtitle" style={{ color: COLORS.textDim, fontSize: 13, marginTop: 6, letterSpacing: "0.02em" }}>
            工時追蹤・一致性分析・風險警示 — {dates[0]}~{dates[dates.length-1]}（{dates.length} 工作天）
          </p>
        </div>

        <StatusOverview allIssues={allIssues} issues={issues} members={members} rawData={rawData!} dates={dates} activeDate={activeDate} />

        {/* Tabs */}
        <div className="animate-in tab-bar" style={{ animationDelay: "0.1s", display: "flex", gap: 4, marginBottom: 24, background: COLORS.card, borderRadius: 10, padding: 4, width: "fit-content" }}>
          {[
            { key: "daily", label: "📊 每日工時" },
            { key: "trend", label: "📈 趨勢比較" },
            { key: "weekly", label: "📋 週統計" },
            ...(commitData ? [{ key: "commits", label: "🔀 Commits" }] : []),
            ...(planAnalysisData && planAnalysisData.planSpecs.length > 0 ? [{ key: "planspec", label: "📋 規劃追蹤" }] : []),
          ].map(tab => (
            <button key={tab.key} className={`tab-btn ${view === tab.key ? 'tab-active' : ''}`} onClick={() => setView(tab.key)} style={tabStyle(view === tab.key)}>
              {tab.label}
            </button>
          ))}
        </div>

        {view === "daily" && (
          <DailyView dailyDates={dailyDates} activeDate={activeDate} onDateSelect={setSelectedDate}
            dayLabels={dayLabels} dailyBarData={dailyBarData}
            chartHeight={chartHeight} memberColors={memberColors} issueMap={issueMap}
            commitData={commitData} leave={leave}
            weeks={weekNav.weeks} weekIndex={weekNav.weekIndex}
            canGoPrev={weekNav.canGoPrev} canGoNext={weekNav.canGoNext}
            isThisWeek={weekNav.isThisWeek} isLastWeek={weekNav.isLastWeek}
            onPrevWeek={() => { weekNav.goToPrev(); setSelectedDate(null); }}
            onNextWeek={() => { weekNav.goToNext(); setSelectedDate(null); }}
            onThisWeek={() => { weekNav.goToThisWeek(); setSelectedDate(null); }}
            onLastWeek={() => { weekNav.goToLastWeek(); setSelectedDate(null); }}
            onSelectWeek={(i: number) => { weekNav.goToWeek(i); setSelectedDate(null); }} />
        )}

        {view === "trend" && (
          <TrendView trendRange={trendRange} onTrendRangeChange={setTrendRange}
            trendDates={trendDates} trendData={trendData} useWeeklyAgg={useWeeklyAgg}
            weekGroups={weekGroups} members={members} memberColors={memberColors}
            selectedMembers={selectedMembers} onToggleMember={toggleMember}
            onClearMembers={() => setSelectedMembers(new Set())}
            isMobile={isMobile} commitData={commitData} rawData={rawData!} leave={leave} />
        )}

        {view === "weekly" && (
          <WeeklyView weeklySummary={weeklySummary} chartHeight={chartHeight}
            members={members} memberColors={memberColors} selectedMembers={selectedMembers}
            onToggleMember={toggleMember} isMobile={isMobile} dates={dates}
            commitData={commitData} leave={leave}
            dailyDates={dailyDates} dayLabels={dayLabels}
            onDateSelectAndSwitchToCommits={dateSelectAndSwitchToCommits} />
        )}

        {view === "commits" && commitData && (
          <CommitsView commitData={commitData} dates={dates} members={members} memberColors={memberColors} leave={leave}
            activeDate={activeDate} onDateSelect={setSelectedDate} dailyDates={dailyDates} dayLabels={dayLabels} taskAnalysisData={taskAnalysisData}
            planSpecs={planAnalysisData?.planSpecs || null} />
        )}

        {view === "planspec" && planAnalysisData && (
          <PlanSpecView planAnalysisData={planAnalysisData} members={members} memberColors={memberColors}
            dates={dates} activeDate={activeDate} onDateSelect={setSelectedDate} />
        )}

        {/* Footer */}
        <div className="footer-bar" style={{ marginTop: 28, paddingTop: 14, borderTop: `1px solid ${COLORS.border}`, display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
          <span style={{ fontSize: 11, color: COLORS.textDim }}>
            ✅ {THRESHOLDS.ok}-{THRESHOLDS.high}hr ｜ ⚠️ {THRESHOLDS.low}-{THRESHOLDS.ok} / {THRESHOLDS.high}-{THRESHOLDS.overtime}hr ｜ ❌ &lt;{THRESHOLDS.low} / &gt;{THRESHOLDS.overtime}hr ｜ 會議 &gt;{MEETING_HEAVY_PCT}% ⚠
          </span>
          <span style={{ fontSize: 11, color: COLORS.textDim }}>
            Daily Update Analyzer v2 — {dates.length} 工作天
          </span>
        </div>
      </div>
    </div>
  );
}
