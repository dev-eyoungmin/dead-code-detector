<?php

namespace App\Controller;

use Symfony\Component\Routing\Attribute\Route;
use App\Service\Mailer;
use App\Entity\User;

class UserController
{
    #[Route('/users', name: 'app_user_list')]
    public function list(Mailer $mailer): Response
    {
        $mailer->send();
    }

    #[Route('/users/{id}', name: 'app_user_show', methods: ['GET'])]
    public function detail(User $user): Response
    {
    }

    public function notRoutedAction()
    {
    }
}
