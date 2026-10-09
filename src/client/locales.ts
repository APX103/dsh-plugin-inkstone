/**
 * Locales for the experimental A2A settings page.
 *
 * @module dsh-plugin-inkstone/client/client/locales
 */

/** Every copy key this page owns. */
export type A2aSettingsLocaleKey =
  | 'title'
  | 'summary'
  | 'ssoTitle'
  | 'ssoConfigured'
  | 'ssoNotConfigured'
  | 'ssoAuthenticated'
  | 'ssoUserId'
  | 'ssoExpiresIn'
  | 'akLabel'
  | 'skLabel'
  | 'signIn'
  | 'signOut'
  | 'ssoSaved'
  | 'ssoModify'
  | 'ssoSave'
  | 'ssoCancel'
  | 'directoryTitle'
  | 'directoryRefresh'
  | 'directoryEmpty'
  | 'addToRoster'
  | 'inRoster'
  | 'rosterTitle'
  | 'rosterEmpty'
  | 'rosterUnavailable'
  | 'rosterEnable'
  | 'rosterDisable'
  | 'rosterRemove'
  | 'tabAgents'
  | 'tabScps'
  | 'tabSkills'
  | 'scpTitle'
  | 'skillsTitle'
  | 'subTitle'
  | 'catalogHint'
  | 'catalogEmpty'
  | 'catalogSearch'
  | 'catalogSearchPlaceholder'
  | 'catalogAdd'
  | 'catalogInstall'
  | 'officialTag'
  | 'localScpsTitle'
  | 'localScpsEmpty'
  | 'localSkillsTitle'
  | 'localSkillsEmpty'
  | 'localEnable'
  | 'localDisable'
  | 'localRemove'
  | 'loading'
  | 'errorPrefix'

/** English copy. */
export const en: Record<A2aSettingsLocaleKey, string> = {
  title: 'Inkstone · A2A Agents',
  summary: 'Sign in to the agent registry, browse remote A2A agents, and choose which ones the assistant can delegate to.',
  ssoTitle: 'Registry sign-in (OpenXLab AK/SK)',
  ssoConfigured: 'Credentials stored',
  ssoNotConfigured: 'Not signed in',
  ssoAuthenticated: 'Session active',
  ssoUserId: 'User',
  ssoExpiresIn: 'Token expires',
  akLabel: 'Access key',
  skLabel: 'Secret key',
  signIn: 'Sign in',
  signOut: 'Sign out',
  ssoSaved: 'Saved',
  ssoModify: 'Modify',
  ssoSave: 'Save',
  ssoCancel: 'Cancel',
  directoryTitle: 'Registry directory',
  directoryRefresh: 'Refresh list',
  directoryEmpty: 'No agents visible to this account. Refresh the list or check registry grants.',
  addToRoster: 'Add',
  inRoster: 'Added',
  rosterTitle: 'Delegation roster',
  rosterEmpty: 'No agents added yet. Add one from the registry directory above.',
  rosterUnavailable: 'The local roster is unavailable or read-only. Reload the page or check the connection.',
  rosterEnable: 'Enable',
  rosterDisable: 'Disable',
  rosterRemove: 'Remove',
  tabAgents: 'Agent Registry',
  tabScps: 'SCP Services',
  tabSkills: 'Skills',
  scpTitle: 'SCP Hub services',
  skillsTitle: 'Skills',
  subTitle: 'Added locally',
  catalogHint: 'Search the SCP Hub catalog to add services.',
  catalogEmpty: 'No catalog results.',
  catalogSearch: 'Search',
  catalogSearchPlaceholder: 'Keyword',
  catalogAdd: 'Add',
  catalogInstall: 'Install',
  officialTag: 'Official',
  localScpsTitle: 'Added SCP services',
  localScpsEmpty: 'No SCP services added yet.',
  localSkillsTitle: 'Installed skills',
  localSkillsEmpty: 'No skills installed yet.',
  localEnable: 'Enable',
  localDisable: 'Disable',
  localRemove: 'Remove',
  loading: 'Loading…',
  errorPrefix: 'Failed',
}

/** Chinese copy. */
export const zh: Record<A2aSettingsLocaleKey, string> = {
  title: '端砚 · A2A 远程 Agent',
  summary: '登录 agent registry，浏览远程 A2A agent，并选择助手可以委派任务的 agent。',
  ssoTitle: 'Registry 登录（OpenXLab AK/SK）',
  ssoConfigured: '已保存凭据',
  ssoNotConfigured: '未登录',
  ssoAuthenticated: '会话有效',
  ssoUserId: '用户',
  ssoExpiresIn: '令牌到期',
  akLabel: 'Access Key',
  skLabel: 'Secret Key',
  signIn: '登录',
  signOut: '退出登录',
  ssoSaved: '已保存',
  ssoModify: '修改',
  ssoSave: '保存',
  ssoCancel: '取消',
  directoryTitle: 'Registry 目录',
  directoryRefresh: '刷新列表',
  directoryEmpty: '当前账号没有可见的 agent。刷新列表或检查 registry 授权。',
  addToRoster: '添加',
  inRoster: '已添加',
  rosterTitle: '委派名单',
  rosterEmpty: '尚未添加 agent。从上方 registry 目录中添加。',
  rosterUnavailable: '本地名单配置不可用或只读，请刷新页面或检查连接。',
  rosterEnable: '启用',
  rosterDisable: '停用',
  rosterRemove: '移除',
  tabAgents: 'Agent Registry',
  tabScps: 'SCP 服务',
  tabSkills: 'Skills',
  scpTitle: 'SCP Hub 服务',
  skillsTitle: '技能',
  subTitle: '已添加到本地',
  catalogHint: '搜索 SCP Hub 目录以添加服务。',
  catalogEmpty: '目录没有匹配结果。',
  catalogSearch: '搜索',
  catalogSearchPlaceholder: '关键词',
  catalogAdd: '添加',
  catalogInstall: '安装',
  officialTag: '官方',
  localScpsTitle: '已添加的 SCP 服务',
  localScpsEmpty: '尚未添加 SCP 服务。',
  localSkillsTitle: '已安装技能',
  localSkillsEmpty: '尚未安装技能。',
  localEnable: '启用',
  localDisable: '停用',
  localRemove: '移除',
  loading: '加载中…',
  errorPrefix: '操作失败',
}
