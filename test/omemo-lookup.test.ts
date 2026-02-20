
import { describe, it, expect, vi } from 'vitest';

// 模拟 client.ts 中的相关逻辑
class MockXmppClient {
  account = { accountId: 'test', omemoEnabled: true };
  omemoManager = {
    fetchDeviceList: vi.fn(),
    encryptMessage: vi.fn(),
    constructOmemoElement: vi.fn()
  };
  xmpp = { send: vi.fn() };
  
  // 模拟 sendMessage 方法中的 OMEMO 逻辑片段
  async sendMessageLogic(to: string, body: string) {
    const normalizedTo = to.replace(/^xmpp:/i, "").trim();
    const [bareTo] = normalizedTo.split("/");
    
    // 关键验证点：是否使用 bare JID 查找设备
    await this.omemoManager.fetchDeviceList(bareTo);
    
    return { normalizedTo, bareTo };
  }
}

describe('OMEMO Device Lookup Logic', () => {
  it('should use bare JID for device lookup', async () => {
    const client = new MockXmppClient();
    client.omemoManager.fetchDeviceList.mockResolvedValue([123]);
    
    const fullJid = 'xmpp:user@example.com/resource';
    const result = await client.sendMessageLogic(fullJid, 'hello');
    
    // 验证 fetchDeviceList 被调用时的参数是 bare JID
    expect(client.omemoManager.fetchDeviceList).toHaveBeenCalledWith('user@example.com');
    expect(result.bareTo).toBe('user@example.com');
    expect(result.normalizedTo).toBe('user@example.com/resource');
  });

  it('should handle JID without resource', async () => {
    const client = new MockXmppClient();
    client.omemoManager.fetchDeviceList.mockResolvedValue([]);
    
    const bareJid = 'user@example.com';
    await client.sendMessageLogic(bareJid, 'hello');
    
    expect(client.omemoManager.fetchDeviceList).toHaveBeenCalledWith('user@example.com');
  });
});
