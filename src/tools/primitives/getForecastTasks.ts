import { executeOmniFocusScript } from '../../utils/scriptExecution.js';

export interface GetForecastTasksOptions {
  days?: number;
  hideCompleted?: boolean;
  includeDeferredOnly?: boolean;
}

export async function getForecastTasks(options: GetForecastTasksOptions = {}): Promise<string> {
  const { days = 7, hideCompleted = true, includeDeferredOnly = false } = options;
  
  try {
    // Execute the forecast tasks script
    const result = await executeOmniFocusScript('@forecastTasks.js', { 
      days: days,
      hideCompleted: hideCompleted,
      includeDeferredOnly: includeDeferredOnly
    });
    
    
    // If result is an object, format it
    if (result && typeof result === 'object') {
      const data = result as any;
      
      if (data.error) {
        throw new Error(data.error);
      }
      
      // Format the forecast tasks. The window counts today as day 1, so
      // days = 7 covers today through today + 6.
      let output = `# 📅 FORECAST - ${days} day${days === 1 ? '' : 's'} (today through ${formatWindowEnd(days)})\n\n`;
      
      if (data.tasksByDate && typeof data.tasksByDate === 'object') {
        const dates = Object.keys(data.tasksByDate).sort();
        
        if (dates.length === 0) {
          output += "🎉 No tasks due in the forecast period - enjoy the calm!\n";
        } else {
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          
          dates.forEach(dateStr => {
            const tasks = data.tasksByDate[dateStr];
            if (!tasks || tasks.length === 0) return;
            
            const [y, m, d] = dateStr.split('-').map(Number);
            const taskDate = new Date(y, m - 1, d);
            // Compare calendar dates, not epoch offsets: a fixed 86400000ms
            // step is wrong across DST transitions.
            const tomorrow = new Date(today);
            tomorrow.setDate(today.getDate() + 1);
            const isToday = isSameCalendarDate(taskDate, today);
            const isTomorrow = isSameCalendarDate(taskDate, tomorrow);
            const isOverdue = taskDate < today;
            
            let dateHeader = '';
            if (isOverdue) {
              dateHeader = `## ⚠️ OVERDUE - ${taskDate.toLocaleDateString()}`;
            } else if (isToday) {
              dateHeader = `## 🔥 TODAY - ${taskDate.toLocaleDateString()}`;
            } else if (isTomorrow) {
              dateHeader = `## ⏰ TOMORROW - ${taskDate.toLocaleDateString()}`;
            } else {
              const dayOfWeek = taskDate.toLocaleDateString('en-US', { weekday: 'long' });
              dateHeader = `## 📅 ${dayOfWeek} - ${taskDate.toLocaleDateString()}`;
            }
            
            output += `${dateHeader}\n`;
            
            tasks.forEach((task: any) => {
              const flagSymbol = task.flagged ? '🚩 ' : '';
              const projectStr = task.projectName ? ` (${task.projectName})` : ' (Inbox)';
              const statusStr = task.taskStatus !== 'Available' ? ` [${task.taskStatus}]` : '';
              const estimateStr = task.estimatedMinutes ? ` ⏱${task.estimatedMinutes}m` : '';
              const typeIndicator = task.isDue ? '📅' : '🚀'; // Due vs Deferred
              // Mark tasks placed by an inherited date, matching filter_tasks' '(eff)' convention
              const effStr = task.usedEffectiveDate ? (task.isDue ? ' [DUE (eff)]' : ' [DEFER (eff)]') : '';

              const idStr = task.id ? ` [${task.id}]` : '';
              output += `• ${typeIndicator} ${flagSymbol}${task.name}${idStr}${projectStr}${effStr}${statusStr}${estimateStr}\n`;
              
              if (task.note && task.note.trim()) {
                output += `  📝 ${task.note.trim()}\n`;
              }
            });
            
            output += '\n';
          });
          
          // Summary
          const totalTasks = dates.reduce((sum, date) => sum + data.tasksByDate[date].length, 0);
          output += `📊 **Summary**: ${totalTasks} task${totalTasks === 1 ? '' : 's'} in forecast\n`;
        }
      } else {
        output += "No forecast data available\n";
      }
      
      return output;
    }
    
    return "Unexpected result format from OmniFocus";
    
  } catch (error) {
    console.error("Error in getForecastTasks:", error);
    throw new Error(`Failed to get forecast tasks: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

// Compare two dates by calendar day (DST-safe — no fixed-millisecond arithmetic)
function isSameCalendarDate(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

// Last day of the inclusive forecast window: today counts as day 1
function formatWindowEnd(days: number): string {
  const end = new Date();
  end.setHours(0, 0, 0, 0);
  end.setDate(end.getDate() + (days - 1));
  return end.toLocaleDateString();
}