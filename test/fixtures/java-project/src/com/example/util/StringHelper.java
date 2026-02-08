package com.example.util;

public class StringHelper {
    public static final String APP_NAME = "MyApp";

    private static final String UNUSED_SECRET = "secret";

    public String capitalize(String input) {
        return internalCapitalize(input);
    }

    public String unusedPublicMethod() {
        return "nobody calls me";
    }

    private String internalCapitalize(String input) {
        if (input == null || input.isEmpty()) {
            return input;
        }
        return input.substring(0, 1).toUpperCase() + input.substring(1);
    }

    private String unusedPrivateMethod() {
        return "truly dead code";
    }
}
