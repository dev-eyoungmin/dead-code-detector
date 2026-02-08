class User:
    def __init__(self, name):
        self.name = name

    def greet(self):
        return f"Hello, {self.name}"

class AdminUser(User):
    def __init__(self, name):
        super().__init__(name)
        self.role = "admin"
