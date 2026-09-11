# -*- coding: utf-8 -*-
"""由 SToneCLI iron-python 执行；使用官方注入的 stone 对象和 Python 3.4 标准库。"""
import json
import socket
import sys
import uuid


class StoneBridge:
    """维护单个 MCP 会话的官方对象；请求只允许清单中的成员，不执行传入的 Python。"""

    def __init__(self, stoneApi, manifest):
        self.stone = stoneApi
        self.manifest = manifest
        self.allowedMethods = set((item['receiver'], item['member']) for item in manifest['methods'])
        self.watches = {}
        self.solutionOpen = False
        self.connected = False
        self.built = False
        self.dirty = False

    def result(self, value):
        """保留官方 Result/Note 语义；进程退出 0 不能代替 IsSuccessful。"""
        return {
            'IsSuccessful': bool(value.IsSuccessful),
            'Errors': [{'Description': str(note.Description)} for note in (value.Errors or [])],
            'Warnings': [{'Description': str(note.Description)} for note in (value.Warnings or [])],
            'Messages': [{'Description': str(note.Description)} for note in (value.Messages or [])],
        }

    def serialize(self, value):
        if value is None or isinstance(value, (str, int, float, bool)):
            return value
        if hasattr(value, 'IsSuccessful'):
            return self.result(value)
        try:
            return [self.serialize(item) for item in value]
        except TypeError:
            return str(value)

    def requireSolution(self):
        if not self.solutionOpen:
            raise ValueError('当前会话没有打开解决方案，请先调用 stone_solution_open 或 stone_solution_create_new_solution。')

    def findNamed(self, values, name):
        for value in values:
            if str(value.Name) == name:
                return value
        raise ValueError('没有找到名称为 ' + str(name) + ' 的官方对象，请先读取对应集合。')

    def targetTasks(self):
        if not self.connected:
            raise ValueError('当前会话没有连接目标，请先连接或下载应用。')
        tasks, result = self.stone.Target.Tasks
        if not result.IsSuccessful:
            raise ValueError(json.dumps(self.result(result), ensure_ascii=False))
        return tasks

    def receiver(self, name, request):
        if name == 'Solution':
            return self.stone.Solution
        if name == 'Target':
            return self.stone.Target
        if name in ('Project', 'ProjectConfiguration'):
            self.requireSolution()
            project = self.findNamed(self.stone.Solution.Projects, request['projectName'])
            if name == 'Project':
                return project
            return self.findNamed(project.ProjectConfigurations, request['configurationName'])
        if name == 'Watch':
            if request['watchId'] not in self.watches:
                raise ValueError('Watch 句柄不属于当前连接或已过期，请重新创建。')
            return self.watches[request['watchId']]['object']
        if name == 'Task':
            return self.findNamed(self.targetTasks(), request['taskName'])
        raise ValueError('没有公开该对象的调用入口。')

    def inspect(self, receiverName, obj):
        """按官方字段白名单序列化，避免反射引入未公开的属性或循环对象。"""
        data = {}
        for field in self.manifest['fields'].get(receiverName, []):
            value = getattr(obj, field)
            if field == 'Projects':
                data[field] = [self.inspect('Project', project) for project in value]
            elif field in ('SolutionConfigurations', 'ActiveSolutionConfiguration'):
                data[field] = [{'Name': str(item.Name)} for item in value] if field == 'SolutionConfigurations' else {'Name': str(value.Name)} if value is not None else None
            elif field in ('ProjectConfigurations', 'ActiveProjectConfiguration'):
                data[field] = [self.inspect('ProjectConfiguration', item) for item in value] if field == 'ProjectConfigurations' else self.inspect('ProjectConfiguration', value) if value is not None else None
            elif field in ('Tasks', 'ActiveTask'):
                tasks, result = value
                data[field] = {'result': self.result(result), 'value': ([self.inspect('Task', item) for item in tasks] if field == 'Tasks' else self.inspect('Task', tasks)) if result.IsSuccessful and tasks is not None else None}
            elif field == 'Watches':
                # Watch 未公开属性表，只返回由 CreateWatch 真正建立的会话句柄。
                data[field] = [{'watchId': key, 'variable': watch['variable']} for key, watch in self.watches.items()]
            else:
                data[field] = self.serialize(value)
        return data

    def dispatch(self, request):
        action = request['action']
        receiverName = request.get('receiver')
        if action == 'inspect':
            if receiverName == 'Solution':
                self.requireSolution()
            return {'value': self.inspect(receiverName, self.receiver(receiverName, request))}
        if action == 'properties':
            fields = request['properties']
            allowed = self.manifest['writable'].get(receiverName, [])
            if not fields or any(key not in allowed for key in fields):
                raise ValueError('只允许修改官方文档声明的可写属性。')
            obj = self.receiver(receiverName, request)
            # 属性可能部分写入后抛异常，提前标记脏状态，绝不把部分操作宣称为事务。
            self.dirty = True
            self.built = False
            for key, value in fields.items():
                setattr(obj, key, value)
            return {'value': self.inspect(receiverName, obj)}
        if action != 'call':
            raise ValueError('不支持该自动化操作。')
        member = request['member']
        if (receiverName, member) not in self.allowedMethods:
            raise ValueError('该成员不在官方方法清单中。')
        if receiverName == 'Solution' and member not in ('Open', 'CreateNewSolution'):
            self.requireSolution()
        if receiverName == 'Solution' and member in ('Open', 'Close', 'CreateNewSolution') and self.dirty:
            raise ValueError('当前解决方案有未保存的修改，请先调用 stone_solution_save。')
        if receiverName == 'Target' and member == 'Download':
            self.requireSolution()
            if not self.built:
                raise ValueError('当前工程尚未真实编译通过，请先调用 stone_solution_build 并检查 Result。')
            if self.connected:
                raise ValueError('官方 Download 要求先断开连接，请调用 stone_target_disconnect。')
        if receiverName == 'Target' and member in ('Restart', 'ClearBinaries', 'CreateWatch') and not self.connected:
            raise ValueError('请先连接目标或下载应用。')
        args = request.get('args', [])
        obj = self.receiver(receiverName, request)
        if member == 'SetActiveSolutionConfiguration':
            args = [self.findNamed(self.stone.Solution.SolutionConfigurations, args[0])]
        if member == 'SetActiveProjectConfiguration':
            args = [self.findNamed(obj.ProjectConfigurations, args[0])]
        projectWrites = ('AddFile', 'RemoveFile', 'ExcludeFileFromProject', 'RenameFile', 'AddLibrary', 'SetActiveProjectConfiguration')
        solutionWrites = ('SetActiveProject', 'CreateNewProject', 'AddExistingProject', 'RemoveProject', 'SetActiveSolutionConfiguration')
        if (receiverName == 'Project' and member in projectWrites) or (receiverName == 'Solution' and member in solutionWrites):
            self.dirty = True
            self.built = False
        raw = getattr(obj, member)(*args)
        if receiverName == 'Solution' and member == 'CreateNewSolution':
            result, solutionPath = raw
            # 文档只保证创建并返回路径，没有保证新工程成为当前打开对象。
            # 必须由下一次显式 Open 建立上下文，不能假定创建后就可以 Save/Build。
            self.solutionOpen = False
            self.dirty = False
            self.built = False
            self.watches.clear()
            return {'result': self.result(result), 'solutionPath': str(solutionPath)}
        if receiverName == 'Target' and member == 'CreateWatch':
            watch, result = raw
            watchId = str(uuid.uuid4()) if result.IsSuccessful else None
            if watchId:
                self.watches[watchId] = {'object': watch, 'variable': request['args'][0]}
            return {'result': self.result(result), 'watchId': watchId}
        if receiverName == 'Watch' and member == 'ReadValue':
            value, result = raw
            return {'result': self.result(result), 'value': str(value)}
        if receiverName == 'Solution':
            if member == 'Build':
                self.built = bool(raw.IsSuccessful)
            if member in ('Open', 'Close'):
                self.watches.clear()
                self.built = False
                if raw or member == 'Open':
                    self.solutionOpen = member == 'Open' and bool(raw)
                    self.dirty = False
            if member == 'Save' and raw:
                self.dirty = False
        if receiverName == 'Project' and member == 'CloseProject':
            self.built = False
        if receiverName == 'Target':
            if member in ('Connect', 'Download') and raw:
                self.connected = True
            if member in ('Disconnect', 'StopSimulator', 'ClearBinaries', 'Restart') and raw is not False:
                self.watches.clear()
                if member != 'ClearBinaries':
                    self.connected = False
        response = {'result': self.result(raw)} if hasattr(raw, 'IsSuccessful') else {'value': self.serialize(raw)}
        if isinstance(raw, bool):
            response['succeeded'] = raw
        if receiverName == 'Project' and member == 'AddLibrary':
            response['succeeded'] = bool(raw)
        return response

    def status(self):
        return {'solutionOpen': self.solutionOpen, 'connected': self.connected, 'built': self.built, 'dirty': self.dirty, 'watchCount': len(self.watches)}


def run(stoneApi):
    """连接仅限本机的带随机凭证通道；EOF 结束会话，不形成后台常驻服务。"""
    with open(sys.argv[1], 'r', encoding='utf-8') as configFile:
        config = json.load(configFile)
    bridge = StoneBridge(stoneApi, config['manifest'])
    connection = socket.create_connection(('127.0.0.1', config['port']), 30)
    connection.settimeout(None)
    stream = connection.makefile('rwb')

    def send(value):
        stream.write((json.dumps(value, ensure_ascii=True) + '\n').encode('utf-8'))
        stream.flush()

    send({'token': config['token'], 'type': 'ready'})
    try:
        while True:
            line = stream.readline(8 * 1024 * 1024 + 1)
            if not line:
                break
            if len(line) > 8 * 1024 * 1024 or not line.endswith(b'\n'):
                raise ValueError('自动化请求超过长度限制。')
            request = json.loads(line.decode('utf-8'))
            try:
                data = bridge.dispatch(request)
                send({'id': request['id'], 'data': data, 'state': bridge.status()})
            except Exception as error:
                send({'id': request['id'], 'error': str(error), 'state': bridge.status()})
    finally:
        if bridge.connected:
            try:
                stoneApi.Target.Disconnect()
            except Exception:
                pass
        stream.close()
        connection.close()


# SToneCLI 的官方契约是执行脚本并注入 stone，没有承诺 __name__ 的取值。
# 直接按官方对象启动，避免嵌入式脚本宿主没有设置 __main__ 时悄悄跳过桥接。
if 'stone' not in globals():
    raise RuntimeError('此脚本必须通过 SToneCLI.exe iron-python 执行，普通 Python 不具备官方 stone 对象。')
run(stone)
