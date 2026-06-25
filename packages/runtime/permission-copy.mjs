const scopeLabels = {
  public_web: '只读公开网页',
  browser: '用无登录态浏览器只读渲染 JS 页面（不下载、不登录、不提交表单）',
  workspace: '读写你工作区的文件',
  shell: '在你机器上执行命令',
  external: '对外发送消息/邮件',
  dangerous: '高危操作（删除/支付/密钥）',
  unknown: '未登记的操作',
};

const riskLabels = {
  L0: '低',
  L1: '低',
  L2: '中',
  L3: '高',
  L4: '极高',
};

export function humanScope(scope) {
  return scopeLabels[scope] ?? scope;
}

export function riskWord(level) {
  return riskLabels[level] ?? '未知';
}

export function permissionRequest({ employeeName, toolLabel, scope, level, reason, validity }) {
  const lineBreak = String.fromCharCode(10);

  return [
    employeeName + ' 想使用 ' + toolLabel + '。',
    '原因：' + (reason || '（未说明）') + '。',
    '权限范围：' + humanScope(scope) + '。',
    '有效期：' + (validity || '仅本次任务') + '。',
    '风险等级：' + riskWord(level) + '。',
  ].join(lineBreak);
}
