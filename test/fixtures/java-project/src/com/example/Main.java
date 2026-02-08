package com.example;

import com.example.util.StringHelper;

public class Main {
    public static void main(String[] args) {
        StringHelper helper = new StringHelper();
        System.out.println(helper.capitalize("hello"));
        System.out.println(StringHelper.APP_NAME);
    }
}
