from utils import helper_function, SOME_CONSTANT
from models import User

def main():
    user = User("Alice")
    result = helper_function(user.name)
    print(f"{SOME_CONSTANT}: {result}")

if __name__ == "__main__":
    main()
