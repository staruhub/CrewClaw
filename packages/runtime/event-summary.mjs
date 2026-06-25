export function hostOf(url) {
  if (typeof url !== 'string') {
    return url;
  }

  const marker = url.indexOf('//');
  if (marker < 0) {
    return url;
  }

  const start = marker + 2;
  const end = url.indexOf('/', start);
  if (end < 0 || end === start) {
    return url;
  }

  return url.slice(start, end);
}

export function summarizeAction({ tool, args = {}, status, decision }) {
  if (decision === 'deny') {
    return '已拦截越权操作：' + (tool || '未知工具');
  }

  let line;
  if (tool === 'web_search') {
    line = '正在搜索来源：' + (args.query || '');
  } else if (tool === 'web_fetch') {
    line = '正在阅读 ' + hostOf(args.url);
  } else if (tool === 'read_file') {
    line = '正在读取 ' + (args.path || '文件');
  } else if (tool === 'search') {
    line = '正在检索本地：' + (args.query || '');
  } else if (tool === 'bash') {
    line = '正在执行命令';
  } else if (tool === 'edit_file' || tool === 'write_file') {
    line = '正在写入 ' + (args.path || '文件');
  } else {
    line = '正在调用 ' + (tool || '工具');
  }

  if (status === 'blocked') {
    line = line + '（已跳过）';
  }

  return line;
}

export function summarizeEvents(events = []) {
  return events.map(summarizeAction);
}
