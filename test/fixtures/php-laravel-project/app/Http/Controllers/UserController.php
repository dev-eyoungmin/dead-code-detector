<?php

namespace App\Http\Controllers;

use App\Models\User;
use App\Services\Mailer;

class UserController
{
    public function index(Mailer $m)
    {
        $m->send();

        return User::query();
    }

    public function legacy()
    {
    }

    public function orphanAction()
    {
    }

    private function helper()
    {
    }
}
