import { describe, it, expect } from 'vitest';
import { collectJavaExports } from '../../../../../src/analyzer/languages/java/javaExportCollector';

describe('javaExportCollector', () => {
  it('should detect public class', () => {
    const content = `package com.example;

public class MyService {
    // ...
}`;
    const exports = collectJavaExports(content, '/MyService.java');
    expect(exports).toHaveLength(1);
    expect(exports[0].name).toBe('MyService');
    expect(exports[0].kind).toBe('class');
  });

  it('should detect public interface', () => {
    const content = `package com.example;

public interface Repository {
    void save();
}`;
    const exports = collectJavaExports(content, '/Repository.java');
    expect(exports).toHaveLength(1);
    expect(exports[0].name).toBe('Repository');
    expect(exports[0].kind).toBe('interface');
  });

  it('should detect public enum', () => {
    const content = `package com.example;

public enum Status {
    ACTIVE, INACTIVE
}`;
    const exports = collectJavaExports(content, '/Status.java');
    expect(exports).toHaveLength(1);
    expect(exports[0].name).toBe('Status');
    expect(exports[0].kind).toBe('enum');
  });

  it('should detect public methods', () => {
    const content = `package com.example;

public class Service {
    public void doSomething() {}
    public String getName() { return ""; }
    private void internal() {}
}`;
    const exports = collectJavaExports(content, '/Service.java');
    const names = exports.map((e) => e.name);
    expect(names).toContain('Service');
    expect(names).toContain('doSomething');
    expect(names).toContain('getName');
    expect(names).not.toContain('internal');
  });

  it('should detect public static final fields as constants', () => {
    const content = `package com.example;

public class Config {
    public static final String APP_NAME = "test";
    public int port = 8080;
    private String secret = "hidden";
}`;
    const exports = collectJavaExports(content, '/Config.java');
    const appName = exports.find((e) => e.name === 'APP_NAME');
    expect(appName).toBeDefined();
    expect(appName!.kind).toBe('constant');
    const port = exports.find((e) => e.name === 'port');
    expect(port).toBeDefined();
    expect(port!.kind).toBe('variable');
  });

  it('should not detect private or package-private as exports', () => {
    const content = `package com.example;

class PackagePrivateClass {}

public class MyClass {
    private void privateMethod() {}
    void packagePrivateMethod() {}
    public void publicMethod() {}
}`;
    const exports = collectJavaExports(content, '/MyClass.java');
    const names = exports.map((e) => e.name);
    expect(names).toContain('MyClass');
    expect(names).toContain('publicMethod');
    expect(names).not.toContain('PackagePrivateClass');
    expect(names).not.toContain('privateMethod');
    expect(names).not.toContain('packagePrivateMethod');
  });

  it('should detect abstract public class', () => {
    const content = `package com.example;

public abstract class BaseService {
    public abstract void handle();
}`;
    const exports = collectJavaExports(content, '/BaseService.java');
    expect(exports[0].name).toBe('BaseService');
    expect(exports[0].kind).toBe('class');
  });

  it('should include line numbers', () => {
    const content = `package com.example;

public class MyClass {
    public void first() {}

    public void second() {}
}`;
    const exports = collectJavaExports(content, '/MyClass.java');
    expect(exports[0].name).toBe('MyClass');
    expect(exports[0].line).toBe(3);
    expect(exports[1].name).toBe('first');
    expect(exports[1].line).toBe(4);
    expect(exports[2].name).toBe('second');
    expect(exports[2].line).toBe(6);
  });

  it('should skip block comments', () => {
    const content = `package com.example;

/*
public class FakeClass {}
*/
public class RealClass {}`;
    const exports = collectJavaExports(content, '/RealClass.java');
    expect(exports).toHaveLength(1);
    expect(exports[0].name).toBe('RealClass');
  });
});
